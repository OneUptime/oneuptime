import {
  FISCAL_START_TITLE,
  SAVE_AS_BUDGET_PLAN,
  SAVE_PLAN_BUDGET,
  SAVE_PLAN_CREATED,
  SAVE_PLAN_DESCRIPTION,
  SAVE_PLAN_EXISTING,
  SAVE_PLAN_NAME,
  SAVE_PLAN_NEW,
  formatCalendarMonthName,
  getFiscalMonthNumbers,
  getFiscalMonthOptions,
} from "./CloudBudgetWords";
import { CloudCostForecastAsk } from "./CloudBudgetReads";
import { formatCloudMoney } from "../CloudCostWords";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  sumCloudBudgetPlan,
} from "Common/Types/Cloud/CloudBudget";
import {
  CloudCostForecast,
  getCloudBudgetPlanFromForecast,
} from "Common/Types/Cloud/CloudCostForecast";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Input from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FORECAST SAVED AS A YEARLY BUDGET'S PLAN (#11008): the next twelve
 * months of what is forecast - with its what-if - as twelve monthly
 * shares, in the fiscal year's order. Into a new yearly budget for what
 * the forecast is of, or an existing yearly budget, whose amount becomes
 * the twelve months' total. The budget's page opens once it is saved.
 */

export const SAVE_PLAN_TARGET_LABEL: string = translationKey("Save into");
export const SAVE_PLAN_NO_YEARLY: string = translationKey(
  "No yearly budget yet: save into a new one.",
);

type SaveTarget = "new" | "existing";

export interface ComponentProps {
  forecast: CloudCostForecast;
  // What the forecast is of: what a new budget counts.
  ask: CloudCostForecastAsk;
  currency: string;
  // A new budget's name to start from: what the forecast is of.
  suggestedName: string;
  onClose: () => void;
}

// What a new yearly budget planned from a forecast is made of.
export function toPlannedBudget(data: {
  ask: CloudCostForecastAsk;
  name: string;
  currency: string;
  fiscalYearStartMonth: number;
  plan: Array<number>;
}): CloudBudget {
  const budget: CloudBudget = new CloudBudget();
  budget.name = data.name.trim();
  budget.scope = data.ask.scope;
  budget.currency = data.currency;
  budget.period = CloudBudgetPeriod.Year;
  budget.fiscalYearStartMonth = data.fiscalYearStartMonth;
  budget.planSplit = CloudBudgetPlanSplit.ByMonth;
  budget.monthlyPlan = data.plan;
  budget.monthlyAmount = sumCloudBudgetPlan(data.plan);
  budget.isEnabled = true;

  if (data.ask.cloudAccountId) {
    budget.cloudAccountId = data.ask.cloudAccountId;
  }

  if (data.ask.cloudCostGroupId) {
    budget.cloudCostGroupId = data.ask.cloudCostGroupId;
  }

  if (data.ask.filterRules) {
    budget.filterRules = data.ask.filterRules;
  }

  if (data.ask.basis) {
    budget.costBasis = data.ask.basis;
  }

  return budget;
}

const CloudForecastSavePlan: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [target, setTarget] = useState<SaveTarget>("new");
  const [name, setName] = useState<string>(props.suggestedName);
  const [fiscalStart, setFiscalStart] = useState<number>(1);
  const [yearlyBudgets, setYearlyBudgets] = useState<Array<CloudBudget>>([]);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let ignore: boolean = false;

    ModelAPI.getList<CloudBudget>({
      modelType: CloudBudget,
      query: { period: CloudBudgetPeriod.Year },
      select: { _id: true, name: true, fiscalYearStartMonth: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    })
      .then((result: ListResult<CloudBudget>): void => {
        if (!ignore) {
          setYearlyBudgets(result.data);
        }
      })
      .catch((): void => {
        // Saving into a new budget still works.
      });

    return (): void => {
      ignore = true;
    };
  }, []);

  const picked: CloudBudget | undefined = yearlyBudgets.find(
    (budget: CloudBudget): boolean => {
      return budget.id?.toString() === budgetId;
    },
  );
  const planStart: number =
    target === "existing" && picked
      ? Number(picked.fiscalYearStartMonth) || 1
      : fiscalStart;
  const plan: Array<number> | null = getCloudBudgetPlanFromForecast({
    forecast: props.forecast,
    fiscalYearStartMonth: planStart,
  });
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: props.currency,
      translator,
      whole: true,
    });
  };
  const budgetOptions: Array<DropdownOption> = yearlyBudgets.map(
    (budget: CloudBudget): DropdownOption => {
      return {
        label: budget.name || "",
        value: budget.id!.toString(),
        // A budget's name, as its owner wrote it.
        isUserContent: true,
      };
    },
  );

  const save: () => Promise<void> = async (): Promise<void> => {
    if (!plan) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      let savedId: ObjectID;

      if (target === "existing" && budgetId) {
        savedId = new ObjectID(budgetId);
        await ModelAPI.updateById<CloudBudget>({
          modelType: CloudBudget,
          id: savedId,
          data: {
            planSplit: CloudBudgetPlanSplit.ByMonth,
            monthlyPlan: plan,
            monthlyAmount: sumCloudBudgetPlan(plan),
          } as unknown as JSONObject,
        });
      } else {
        const response: { data: unknown } = await ModelAPI.create<CloudBudget>({
          model: toPlannedBudget({
            ask: props.ask,
            name,
            currency: props.currency,
            fiscalYearStartMonth: fiscalStart,
            plan,
          }),
          modelType: CloudBudget,
        });
        const created: JSONObject = (response.data || {}) as JSONObject;
        savedId = new ObjectID(String(created["_id"] || ""));
      }

      Toast.success(
        translator.translateText(SAVE_PLAN_CREATED) || SAVE_PLAN_CREATED,
      );
      props.onClose();
      Navigation.navigate(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_BUDGET_VIEW] as Route,
          { modelId: savedId },
        ),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canSave: boolean =
    Boolean(plan) &&
    (target === "existing" ? Boolean(budgetId) : name.trim().length >= 2);

  return (
    <Modal
      title={SAVE_AS_BUDGET_PLAN}
      description={SAVE_PLAN_DESCRIPTION}
      modalWidth={ModalWidth.Medium}
      submitButtonText={SAVE_AS_BUDGET_PLAN}
      onClose={props.onClose}
      onSubmit={() => {
        void save();
      }}
      isLoading={isSaving}
      disableSubmitButton={!canSave}
      error={error}
    >
      <div className="space-y-4" data-testid="cloud-forecast-save-plan">
        <div>
          <p className="text-sm font-medium text-gray-700">
            {translator.translateText(SAVE_PLAN_TARGET_LABEL)}
          </p>
          <FilterButtons
            ariaLabel={SAVE_PLAN_TARGET_LABEL}
            dataTestId="cloud-forecast-save-target"
            className="mt-1"
            selectedValue={target}
            options={[
              { label: SAVE_PLAN_NEW, value: "new" },
              { label: SAVE_PLAN_EXISTING, value: "existing" },
            ]}
            onSelect={(value: string) => {
              setTarget(value === "existing" ? "existing" : "new");
            }}
          />
        </div>
        {target === "new" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cloud-forecast-plan-name"
                className="block text-sm font-medium text-gray-700"
              >
                {translator.translateText(SAVE_PLAN_NAME)}
              </label>
              <div className="mt-1">
                <Input
                  id="cloud-forecast-plan-name"
                  value={name}
                  dataTestId="cloud-forecast-plan-name"
                  onChange={(text: string) => {
                    setName(text);
                  }}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="cloud-forecast-plan-fiscal-start"
                className="block text-sm font-medium text-gray-700"
              >
                {translator.translateText(FISCAL_START_TITLE)}
              </label>
              <div className="mt-1">
                <Dropdown
                  inputId="cloud-forecast-plan-fiscal-start"
                  isClearable={false}
                  options={getFiscalMonthOptions(translator)}
                  value={getFiscalMonthOptions(translator).find(
                    (option: DropdownOption): boolean => {
                      return option.value === fiscalStart;
                    },
                  )}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    setFiscalStart(Number(value) || 1);
                  }}
                />
              </div>
            </div>
          </div>
        ) : yearlyBudgets.length === 0 ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(SAVE_PLAN_NO_YEARLY)}
          </p>
        ) : (
          <div>
            <label
              htmlFor="cloud-forecast-plan-budget"
              className="block text-sm font-medium text-gray-700"
            >
              {translator.translateText(SAVE_PLAN_BUDGET)}
            </label>
            <div className="mt-1">
              <Dropdown
                inputId="cloud-forecast-plan-budget"
                isClearable={false}
                options={budgetOptions}
                value={budgetOptions.find((option: DropdownOption): boolean => {
                  return option.value === budgetId;
                })}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setBudgetId(value ? String(value) : null);
                }}
              />
            </div>
          </div>
        )}
        {plan ? (
          <ul
            className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-gray-50 p-3 text-sm sm:grid-cols-3"
            data-testid="cloud-forecast-plan-preview"
          >
            {getFiscalMonthNumbers(planStart).map(
              (monthNumber: number, index: number): ReactElement => {
                return (
                  <li key={monthNumber} className="flex justify-between gap-2">
                    <span className="text-gray-600">
                      {formatCalendarMonthName(monthNumber, translator)}
                    </span>
                    <span className="text-gray-900">
                      {money(plan[index] || 0)}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudForecastSavePlan;
