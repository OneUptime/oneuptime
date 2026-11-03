import Route from "Common/Types/API/Route";
import { Gray500, Red, Yellow } from "Common/Types/BrandColors";
import { CloudCostState } from "Common/Types/Cloud/CloudCost";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import Color from "Common/Types/Color";
import Card from "Common/UI/Components/Card/Card";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { READ_THE_GUIDE } from "./CloudCostSetupSteps";
import {
  COST_SETUP_DOCS_PATHS,
  COST_SETUP_STEPS,
  COST_STATE_LABELS,
  SAVINGS_SETUP_DOCS_PATHS,
  SAVINGS_SETUP_STEPS,
} from "./CloudCostWords";
import { cloudConnectionDocsUrl } from "./Connect/CloudConnectApi";
import CloudConnectionLogo from "./Connect/CloudConnectionLogo";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * The accounts left out of the figures above them, each with why: costs
 * (or ways to spend less) its cloud would not give - in the cloud's own
 * words, with what to do - not read yet, or billed in another currency
 * than the one the figures are in. So an account that is left out is
 * never read as one that costs nothing, or has nothing to save.
 */

export const COST_GAPS_TITLE: string = translationKey(
  "Accounts whose costs are not read",
);
export const COST_GAPS_DESCRIPTION: string = translationKey(
  "Their costs are left out of the figures above until they are.",
);
export const SAVINGS_GAPS_TITLE: string = translationKey(
  "Accounts whose recommendations are not read",
);
export const SAVINGS_GAPS_DESCRIPTION: string = translationKey(
  "Their ways to spend less are left out until they are.",
);
export const WAITING_FOR_FIRST_READ: string = translationKey(
  "Waiting for the first read",
);
export const BILLED_IN_ANOTHER_CURRENCY: string = translationKey(
  "Billed in {{currency}}",
);
export const ANOTHER_CURRENCY_NOTE: string = translationKey(
  "The figures above are in {{currency}}, the currency most of your accounts are billed in.",
);

export type CloudCostGapKind = "costs" | "savings";

export interface CloudCostGapRow {
  account: CloudAccountRow;
  // Why it is left out: its state, waiting for a first read, or its currency.
  reason: CloudCostState | "waiting" | "currency";
  message: string;
  // The currency it is billed in, when that is why.
  currency?: string | undefined;
}

export function getCloudCostGapRows(data: {
  accounts: Array<CloudAccountRow>;
  // The currency the figures are in.
  currency: string;
  kind: CloudCostGapKind;
}): Array<CloudCostGapRow> {
  const rows: Array<CloudCostGapRow> = [];

  for (const account of data.accounts) {
    const summary: {
      state: CloudCostState;
      message?: string | undefined;
      currency: string;
    } | null =
      data.kind === "costs" ? account.costSummary : account.savingsSummary;

    if (!summary) {
      // An account no connection reads is said so on its own pages.
      if (account.hasConnection) {
        rows.push({ account, reason: "waiting", message: "" });
      }
      continue;
    }

    if (summary.state !== CloudCostState.Reading) {
      rows.push({
        account,
        reason: summary.state,
        message: summary.message || "",
      });
      continue;
    }

    if (
      data.kind === "costs" &&
      summary.currency.toUpperCase() !== data.currency.toUpperCase()
    ) {
      rows.push({
        account,
        reason: "currency",
        message: "",
        currency: summary.currency,
      });
    }
  }

  return rows;
}

const GAP_COLORS: Readonly<Record<CloudCostGapRow["reason"], Color>> = {
  [CloudCostState.Reading]: Gray500,
  [CloudCostState.NotAllowed]: Yellow,
  [CloudCostState.NotSetUp]: Yellow,
  [CloudCostState.Failed]: Red,
  waiting: Gray500,
  currency: Gray500,
};

export interface ComponentProps {
  rows: Array<CloudCostGapRow>;
  kind: CloudCostGapKind;
  currency: string;
}

const CloudCostGapsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.rows.length === 0) {
    return <></>;
  }

  const steps: Readonly<Record<CloudProvider, string>> =
    props.kind === "costs" ? COST_SETUP_STEPS : SAVINGS_SETUP_STEPS;
  const docs: Readonly<Record<CloudProvider, string>> =
    props.kind === "costs" ? COST_SETUP_DOCS_PATHS : SAVINGS_SETUP_DOCS_PATHS;
  const hasOtherCurrency: boolean = props.rows.some(
    (row: CloudCostGapRow): boolean => {
      return row.reason === "currency";
    },
  );

  return (
    <Card
      title={props.kind === "costs" ? COST_GAPS_TITLE : SAVINGS_GAPS_TITLE}
      description={
        props.kind === "costs"
          ? COST_GAPS_DESCRIPTION
          : SAVINGS_GAPS_DESCRIPTION
      }
    >
      <div data-testid={`cloud-${props.kind}-gaps`}>
        {hasOtherCurrency ? (
          <p className="mb-3 text-sm text-gray-600">
            {translator.translateTemplate(ANOTHER_CURRENCY_NOTE, {
              currency: props.currency,
            })}
          </p>
        ) : (
          <></>
        )}
        <ul className="-mt-3 divide-y divide-gray-100">
          {props.rows.map((row: CloudCostGapRow): ReactElement => {
            const provider: CloudProvider = row.account
              .provider as CloudProvider;
            const step: string | undefined =
              row.reason === CloudCostState.NotAllowed ||
              row.reason === CloudCostState.NotSetUp
                ? steps[provider]
                : undefined;
            const label: string =
              row.reason === "waiting"
                ? WAITING_FOR_FIRST_READ
                : row.reason === "currency"
                  ? translator.translateTemplate(BILLED_IN_ANOTHER_CURRENCY, {
                      currency: row.currency || "",
                    })
                  : COST_STATE_LABELS[row.reason];

            return (
              <li
                key={row.account.id.toString()}
                className="flex items-start gap-3 py-3"
                data-testid="cloud-cost-gap"
                data-reason={row.reason}
              >
                <CloudConnectionLogo
                  provider={row.account.provider}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                        { modelId: row.account.id },
                      )}
                      className="min-w-0 break-words text-sm font-medium text-gray-900 hover:underline"
                    >
                      {row.account.name || row.account.accountId}
                    </AppLink>
                    <Pill text={label} color={GAP_COLORS[row.reason]} />
                  </div>
                  {row.message ? (
                    <p
                      className="mt-1 line-clamp-3 break-words text-xs text-gray-600"
                      data-testid="cloud-cost-gap-message"
                    >
                      {row.message}
                    </p>
                  ) : (
                    <></>
                  )}
                  {step ? (
                    <p className="mt-1 text-xs text-gray-600">
                      {translator.translateText(step)}{" "}
                      <a
                        href={cloudConnectionDocsUrl(docs[provider]).toString()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {translator.translateText(READ_THE_GUIDE)}
                      </a>
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
};

export default CloudCostGapsCard;
