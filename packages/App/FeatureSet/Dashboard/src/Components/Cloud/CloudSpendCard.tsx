import Route from "Common/Types/API/Route";
import {
  CloudAccountCostSummary,
  CloudCostTotals,
} from "Common/Types/Cloud/CloudCost";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RankedBars, { RankedBarItem } from "../SecurityOverview/RankedBars";
import { CloudCostShare, mergeCloudTopServices } from "./CloudCostReads";
import CloudCostSetupSteps, {
  getCloudProvidersOf,
} from "./CloudCostSetupSteps";
import {
  LAST_MONTH,
  PROJECTED_MONTH,
  SO_FAR_THIS_MONTH,
  formatCloudMoney,
  hasCloudCosts,
} from "./CloudCostWords";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * Cloud Overview's Spend: what the accounts cost this month so far, what
 * the month is on course for and what last month came to, then the
 * services that cost the most - with the way to Costs, where all of it is
 * broken down. Before any account's costs are read it says what each cloud
 * needs for them to be.
 */

export const SPEND_CARD_TITLE: string = translationKey("Spend");
export const SPEND_CARD_DESCRIPTION: string = translationKey(
  "What your accounts cost, from each cloud's own billing.",
);
export const SPEND_CARD_NOT_READ: string = translationKey(
  "No account's costs are read yet. Each cloud needs one thing first:",
);
export const TOP_SERVICES_TITLE: string = translationKey(
  "Top services this month",
);
export const NO_SERVICES_YET: string = translationKey(
  "No service has cost anything this month yet.",
);
export const VIEW_COSTS: string = translationKey("View costs");
// The services the card lists: the few that cost the most.
export const SPEND_CARD_SERVICES_SHOWN: number = 5;

export interface ComponentProps {
  accounts: Array<CloudAccountRow>;
  costs: CloudCostTotals;
  costsRoute: Route;
}

export const CloudCostFigure: FunctionComponent<{
  label: string;
  value: string;
  testId: string;
}> = (props: {
  label: string;
  value: string;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0" data-testid={props.testId}>
      <dt className="text-xs font-medium text-gray-500">
        {translator.translateText(props.label)}
      </dt>
      <dd className="mt-1 break-words text-lg font-semibold text-gray-900">
        <bdi>{props.value}</bdi>
      </dd>
    </div>
  );
};

export const CloudCardFooterLink: FunctionComponent<{
  to: Route;
  text: string;
  testId: string;
}> = (props: { to: Route; text: string; testId: string }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mt-5">
      <AppLink
        to={props.to}
        dataTestId={props.testId}
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        <span>{translator.translateText(props.text)}</span>
        {/* Icon turns an arrow round for a page read right to left. */}
        <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
      </AppLink>
    </div>
  );
};

const CloudSpendCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const costs: CloudCostTotals = props.costs;

  if (!hasCloudCosts(costs)) {
    return (
      <Card title={SPEND_CARD_TITLE} description={SPEND_CARD_DESCRIPTION}>
        <div data-testid="cloud-spend-card" data-state="not-read">
          <p className="mb-4 text-sm text-gray-600">
            {translator.translateText(SPEND_CARD_NOT_READ)}
          </p>
          <CloudCostSetupSteps
            kind="costs"
            providers={getCloudProvidersOf(props.accounts)}
          />
          <CloudCardFooterLink
            to={props.costsRoute}
            text={VIEW_COSTS}
            testId="cloud-spend-card-link"
          />
        </div>
      </Card>
    );
  }

  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({ amount, currency: costs.currency, translator });
  };

  const services: Array<CloudCostShare> = mergeCloudTopServices({
    summaries: props.accounts.map(
      (account: CloudAccountRow): CloudAccountCostSummary | null => {
        return account.costSummary;
      },
    ),
    currency: costs.currency,
    top: SPEND_CARD_SERVICES_SHOWN,
  });

  return (
    <Card title={SPEND_CARD_TITLE} description={SPEND_CARD_DESCRIPTION}>
      <div data-testid="cloud-spend-card" data-state="read">
        {/*
         * Three figures in a row while the card has the room, one under
         * another on a phone: by the card's width, not the window's.
         */}
        <div className="[container-type:inline-size]">
          <dl className="grid grid-cols-1 gap-4 [@container(min-width:22rem)]:grid-cols-3">
            <CloudCostFigure
              label={SO_FAR_THIS_MONTH}
              value={money(costs.monthToDate)}
              testId="cloud-spend-month-to-date"
            />
            <CloudCostFigure
              label={PROJECTED_MONTH}
              value={money(costs.projectedMonth)}
              testId="cloud-spend-projected"
            />
            <CloudCostFigure
              label={LAST_MONTH}
              value={money(costs.lastMonth)}
              testId="cloud-spend-last-month"
            />
          </dl>
        </div>
        <div className="mt-6">
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">
            {translator.translateText(TOP_SERVICES_TITLE)}
          </div>
          <div data-testid="cloud-spend-services">
            <RankedBars
              emptyText={NO_SERVICES_YET}
              items={services.map((share: CloudCostShare): RankedBarItem => {
                return {
                  key: share.key,
                  label: <bdi>{share.key}</bdi>,
                  title: share.key,
                  count: share.amount,
                  countText: money(share.amount),
                };
              })}
            />
          </div>
        </div>
        <CloudCardFooterLink
          to={props.costsRoute}
          text={VIEW_COSTS}
          testId="cloud-spend-card-link"
        />
      </div>
    </Card>
  );
};

export default CloudSpendCard;
