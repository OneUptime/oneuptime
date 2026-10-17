import SubscriptionPlan from "../../../../Types/Billing/SubscriptionPlan";
import { PRICING_PAGE_URL } from "../../../../Types/Billing/PayAsYouGoPricing";
import {
  BillingPeriod,
  YearlySaving,
  findPlanByPlanId,
  getBillingPeriodOfPlanId,
  getPlanIdForPeriod,
  getYearlySaving,
} from "../../../../Types/Billing/SubscriptionPlanPricing";
import IconProp from "../../../../Types/Icon/IconProp";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import { NEW_TAB_DESCRIPTION } from "../../Markdown.tsx/MarkdownLink";
import {
  PlanPickerCopy,
  PlanPickerOptionText,
  PlanTermsText,
  getPlanPickerOptionText,
  getPlanTermsText,
  getSentenceSeparator,
  getYearlySavingText,
  joinSentences,
} from "./PlanPickerCopy";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * Picking the plan a new project starts on: a calm comparison of the plans,
 * one row each - the plan's name, who it is for and its trial on the left,
 * its price per user on the right - under a Monthly | Yearly switch that
 * sets the period every price is shown for, and over a line that says what
 * picking the selected plan means for money (PlanPickerCopy).
 *
 * The value is the Stripe price the project is subscribed to - the plan's
 * monthly or yearly id - so the period travels with the plan: switching it
 * keeps the plan picked and changes which of its prices is picked.
 *
 * The rows are real radio buttons, named by the plan, so arrow keys move
 * between plans and a screen reader reads each one's price and trial. The
 * colours are the shared utilities Theme.css carries into the dark theme.
 */

export interface ComponentProps {
  plans: Array<SubscriptionPlan>;
  // The picked plan id ("" for none).
  value: string;
  onChange: (planId: string) => void;
  // The period shown before anything is picked. Yearly, as on the pricing page.
  initialPeriod?: BillingPeriod | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

const periodOf: (
  plans: Array<SubscriptionPlan>,
  planId: string,
) => BillingPeriod | null = (
  plans: Array<SubscriptionPlan>,
  planId: string,
): BillingPeriod | null => {
  const plan: SubscriptionPlan | undefined = findPlanByPlanId(plans, planId);

  return plan ? getBillingPeriodOfPlanId(plan, planId) : null;
};

const PlanPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = `plan-picker-${useId()}`;
  const labelId: string = `${id}-label`;
  const errorId: string = `${id}-error`;

  const [period, setPeriod] = useState<BillingPeriod>(() => {
    return (
      periodOf(props.plans, props.value) ||
      props.initialPeriod ||
      BillingPeriod.Yearly
    );
  });

  // A value set from outside (a form's initial values) brings its period.
  useEffect(() => {
    const valuePeriod: BillingPeriod | null = periodOf(
      props.plans,
      props.value,
    );

    if (valuePeriod && valuePeriod !== period) {
      setPeriod(valuePeriod);
    }
  }, [props.value]);

  const selectedPlan: SubscriptionPlan | undefined = findPlanByPlanId(
    props.plans,
    props.value,
  );

  const saving: YearlySaving | null = getYearlySaving(props.plans);
  const savingText: string | null = getYearlySavingText({
    saving,
    translator,
  });

  const changePeriod: (next: BillingPeriod) => void = (
    next: BillingPeriod,
  ): void => {
    if (next === period) {
      return;
    }

    setPeriod(next);

    // The same plan stays picked, at the other period's price.
    if (selectedPlan) {
      props.onChange(getPlanIdForPeriod(selectedPlan, next));
    }
  };

  const renderPeriodButton: (
    buttonPeriod: BillingPeriod,
    label: string,
  ) => ReactElement = (
    buttonPeriod: BillingPeriod,
    label: string,
  ): ReactElement => {
    const isActive: boolean = period === buttonPeriod;

    return (
      <button
        type="button"
        aria-pressed={isActive}
        data-testid={`plan-picker-period-${buttonPeriod.toLowerCase()}`}
        className={`inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          isActive
            ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
            : "text-gray-500 hover:text-gray-900"
        }`}
        onClick={() => {
          changePeriod(buttonPeriod);
        }}
      >
        {translator.translateText(label)}
      </button>
    );
  };

  const renderOption: (
    plan: SubscriptionPlan,
    index: number,
  ) => ReactElement = (plan: SubscriptionPlan, index: number): ReactElement => {
    const planId: string = getPlanIdForPeriod(plan, period);
    const isSelected: boolean = Boolean(
      selectedPlan && selectedPlan.getName() === plan.getName(),
    );
    const text: PlanPickerOptionText = getPlanPickerOptionText({
      plan,
      period,
      translator,
    });
    const optionId: string = `${id}-option-${index}`;
    const isFirst: boolean = index === 0;
    const isLast: boolean = index === props.plans.length - 1;

    const describedBy: string = [
      text.trialBadge ? `${optionId}-trial` : "",
      text.audience ? `${optionId}-audience` : "",
      `${optionId}-price`,
    ]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" ");

    return (
      <label
        key={plan.getName()}
        htmlFor={optionId}
        data-testid={`plan-picker-option-${plan.getName()}`}
        data-selected={isSelected ? "true" : "false"}
        className={`relative flex cursor-pointer items-start gap-3 border px-4 py-3 transition-colors duration-150 ${
          isFirst ? "rounded-t-lg" : ""
        } ${isLast ? "rounded-b-lg" : ""} ${
          isSelected
            ? "z-10 border-indigo-300 bg-indigo-50"
            : props.error
              ? "border-red-300 bg-white hover:bg-gray-50"
              : "border-gray-200 bg-white hover:bg-gray-50"
        }`}
      >
        <input
          id={optionId}
          type="radio"
          name={`${id}-plan`}
          value={planId}
          checked={isSelected}
          aria-labelledby={`${optionId}-name`}
          aria-describedby={describedBy}
          className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-indigo-600"
          onChange={() => {
            props.onChange(planId);
          }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <span className="block min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                id={`${optionId}-name`}
                className="text-sm font-semibold text-gray-900"
              >
                {text.name}
              </span>
              {text.trialBadge && (
                <span
                  id={`${optionId}-trial`}
                  className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200"
                >
                  {text.trialBadge}
                </span>
              )}
            </span>
            {text.audience && (
              <span
                id={`${optionId}-audience`}
                className="mt-0.5 block text-sm text-gray-500"
              >
                {text.audience}
              </span>
            )}
          </span>
          {/*
           * The price with its unit, and under it how it is billed - on a
           * phone too, where the price sits under the plan's line. Each piece
           * stays whole: a narrow phone, or a long language, never breaks
           * inside "billed yearly". It used to follow the unit after a dot on
           * a phone, and on a 360px phone in Russian the line broke inside it
           * ("· оплата / ежегодно"), or put the dot first on a line of its
           * own. The spaces between the pieces are real text, so a screen
           * reader reading the radio's description hears "$20 per user /
           * month billed yearly", not "$20per user".
           */}
          <span
            id={`${optionId}-price`}
            className="block flex-shrink-0 sm:text-right"
          >
            <span className="text-sm font-semibold text-gray-900">
              {text.price}
            </span>
            {text.priceUnit && (
              <>
                {" "}
                <span className="whitespace-nowrap text-xs text-gray-500">
                  {text.priceUnit}
                </span>
              </>
            )}
            {text.priceCaption && (
              <>
                {" "}
                <span className="block whitespace-nowrap text-xs text-gray-500">
                  {text.priceCaption}
                </span>
              </>
            )}
          </span>
        </span>
      </label>
    );
  };

  const terms: PlanTermsText | null = selectedPlan
    ? getPlanTermsText({ plan: selectedPlan, period, translator })
    : null;

  return (
    <div data-testid={props.dataTestId || "plan-picker"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="block text-sm font-medium text-gray-700">
          {translator.translateText(PlanPickerCopy.label)}
        </span>
        <div className="flex items-center gap-2">
          {savingText && (
            <span
              data-testid="plan-picker-saving"
              className={`text-xs font-medium ${
                period === BillingPeriod.Yearly
                  ? "text-green-700"
                  : "text-gray-500"
              }`}
            >
              {savingText}
            </span>
          )}
          <div
            role="group"
            aria-label={translator.translateText(PlanPickerCopy.billingPeriod)}
            className="inline-flex items-center rounded-lg bg-gray-100 p-0.5 ring-1 ring-inset ring-gray-200"
          >
            {renderPeriodButton(BillingPeriod.Monthly, PlanPickerCopy.monthly)}
            {renderPeriodButton(BillingPeriod.Yearly, PlanPickerCopy.yearly)}
          </div>
        </div>
      </div>

      {/*
       * With an error ("Plan is required."), the plans are drawn in the red
       * border the form's text fields take (Input's border-red-300, which
       * the dark theme softens too), and the error is written under them as
       * those fields write theirs: the same red, the same gap, read with the
       * group by a screen reader - so the dialog's two errors read as one
       * kind of thing.
       */}
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        data-invalid={props.error ? "true" : undefined}
        className="mt-2 -space-y-px rounded-lg"
      >
        {props.plans.map(renderOption)}
      </div>

      {props.error && (
        <p
          id={errorId}
          role="alert"
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
        >
          {props.error}
        </p>
      )}

      {terms && (
        <div
          data-testid="plan-picker-terms"
          aria-live="polite"
          className="mt-3 flex gap-2.5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600"
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <div className="min-w-0">
            <p
              data-testid="plan-picker-terms-headline"
              className="font-medium text-gray-900"
            >
              {terms.headline}
            </p>
            {/*
             * A div, not a p: the link's icon (Icon) is drawn in a div, which
             * a paragraph may not hold.
             */}
            <div data-testid="plan-picker-terms-details" className="mt-0.5">
              {joinSentences(terms.details)}
              {terms.details.length > 0
                ? getSentenceSeparator(joinSentences(terms.details))
                : ""}
              {/*
               * One unit, never broken over two lines ("Compare / plans"),
               * with the mark the product puts on a link that opens a tab of
               * its own - and says so to a screen reader (MarkdownLink).
               */}
              <a
                href={PRICING_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-description={translator.translateText(NEW_TAB_DESCRIPTION)}
                data-testid="plan-picker-compare-plans"
                className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-indigo-600 underline-offset-2 hover:underline"
              >
                {translator.translateText(PlanPickerCopy.comparePlans)}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanPicker;
