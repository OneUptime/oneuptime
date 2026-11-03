import Route from "Common/Types/API/Route";
import { CloudCostState } from "Common/Types/Cloud/CloudCost";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  CLOUD_ACCOUNT_STATUS_COLORS,
  CloudAccountStatus,
  getCloudAccountStatus,
} from "./CloudAccountStatus";
import {
  COST_STATE_LABELS,
  SO_FAR_THIS_MONTH,
  formatCloudMoney,
} from "./CloudCostWords";
import { COSTS_NOT_READ_YET } from "./CloudOverviewTiles";
import { CloudCardFooterLink } from "./CloudSpendCard";
import CloudConnectionLogo from "./Connect/CloudConnectionLogo";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * Cloud Overview's Accounts: each connected account with whether a
 * connection reads it, how many resources it holds and what it cost this
 * month - the most costly first - each one click from its own Overview.
 * The first CLOUD_ACCOUNTS_CARD_SHOWN, then the way to them all.
 */

export const ACCOUNTS_CARD_TITLE: string = translationKey("Accounts");
export const ACCOUNTS_CARD_DESCRIPTION: string = translationKey(
  "Each account your connections read, the most costly first.",
);
export const ACCOUNT_RESOURCES: PluralTemplate = {
  one: "{{count}} resource",
  other: "{{count}} resources",
};
export const VIEW_ALL_ACCOUNTS: string = translationKey("View all accounts");
export const CLOUD_ACCOUNTS_CARD_SHOWN: number = 8;

/*
 * The accounts in the card's order: those costing the most this month (in
 * the totals' currency) first, then by name as people read numbers in
 * names.
 */
export function sortCloudAccountsBySpend(
  accounts: Array<CloudAccountRow>,
  currency: string,
): Array<CloudAccountRow> {
  const spend: (account: CloudAccountRow) => number = (
    account: CloudAccountRow,
  ): number => {
    const summary: CloudAccountRow["costSummary"] = account.costSummary;

    return summary &&
      summary.state === CloudCostState.Reading &&
      summary.currency.toUpperCase() === currency.toUpperCase()
      ? summary.monthToDate
      : -1;
  };

  return [...accounts].sort(
    (a: CloudAccountRow, b: CloudAccountRow): number => {
      return (
        spend(b) - spend(a) ||
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    },
  );
}

/*
 * Laid out by the card's width: the spend ends the row from 30rem and goes
 * under the account's name below it, so a phone never squeezes the name.
 */
export const CLOUD_ACCOUNT_ROW_CLASS_NAME: string =
  "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-3 [@container(min-width:30rem)]:grid-cols-[auto_minmax(0,1fr)_auto]";
export const CLOUD_ACCOUNT_ROW_END_CLASS_NAME: string =
  "col-start-2 [@container(min-width:30rem)]:col-start-auto [@container(min-width:30rem)]:text-end";

export interface ComponentProps {
  accounts: Array<CloudAccountRow>;
  currency: string;
  accountsRoute: Route;
}

const CloudAccountsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = OneUptimeDate.getCurrentDate();
  const sorted: Array<CloudAccountRow> = sortCloudAccountsBySpend(
    props.accounts,
    props.currency,
  );
  const shown: Array<CloudAccountRow> = sorted.slice(
    0,
    CLOUD_ACCOUNTS_CARD_SHOWN,
  );

  return (
    <Card title={ACCOUNTS_CARD_TITLE} description={ACCOUNTS_CARD_DESCRIPTION}>
      <div
        className="[container-type:inline-size]"
        data-testid="cloud-accounts-card"
      >
        <ul className="-mt-3 divide-y divide-gray-100">
          {shown.map((account: CloudAccountRow): ReactElement => {
            const status: CloudAccountStatus = getCloudAccountStatus({
              lastSeenAt: account.lastSeenAt,
              hasConnection: account.hasConnection,
              now,
            });
            const where: string = [
              getCloudProviderLabel(account.provider),
              account.accountId !== account.name ? account.accountId : "",
            ]
              .filter((part: string): boolean => {
                return part.length > 0;
              })
              .join(" · ");
            const summary: CloudAccountRow["costSummary"] = account.costSummary;

            return (
              <li
                key={account.id.toString()}
                className={CLOUD_ACCOUNT_ROW_CLASS_NAME}
                data-testid="cloud-accounts-card-row"
              >
                <CloudConnectionLogo provider={account.provider} size="sm" />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.CLOUD_ACCOUNT_VIEW] as Route,
                        { modelId: account.id },
                      )}
                      className="min-w-0 break-words text-sm font-medium text-gray-900 hover:underline"
                    >
                      {account.name || account.accountId || "—"}
                    </AppLink>
                    <Pill
                      text={status.label}
                      color={CLOUD_ACCOUNT_STATUS_COLORS[status.tone]}
                    />
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    <bdi className="break-all">{where}</bdi>
                    {" · "}
                    {translator.translatePlural(
                      ACCOUNT_RESOURCES,
                      account.resourceCount,
                    )}
                  </div>
                </div>
                <div
                  className={CLOUD_ACCOUNT_ROW_END_CLASS_NAME}
                  data-testid="cloud-accounts-card-spend"
                >
                  {summary && summary.state === CloudCostState.Reading ? (
                    <>
                      <div className="text-sm font-semibold tabular-nums text-gray-900">
                        <bdi>
                          {formatCloudMoney({
                            amount: summary.monthToDate,
                            currency: summary.currency,
                            translator,
                          })}
                        </bdi>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {translator.translateText(SO_FAR_THIS_MONTH)}
                      </div>
                    </>
                  ) : summary ? (
                    <span className="text-xs text-amber-700">
                      {translator.translateText(
                        COST_STATE_LABELS[summary.state],
                      )}
                    </span>
                  ) : account.hasConnection ? (
                    /*
                     * Read by a connection that has not read its costs yet:
                     * said so, never an empty end that could read as
                     * costing nothing.
                     */
                    <span
                      className="text-xs text-gray-500"
                      data-state="waiting"
                    >
                      {translator.translateText(COSTS_NOT_READ_YET)}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <CloudCardFooterLink
          to={props.accountsRoute}
          text={VIEW_ALL_ACCOUNTS}
          testId="cloud-accounts-card-link"
        />
      </div>
    </Card>
  );
};

export default CloudAccountsCard;
