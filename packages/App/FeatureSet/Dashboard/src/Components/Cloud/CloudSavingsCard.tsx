import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import Route from "Common/Types/API/Route";
import {
  CLOUD_SAVING_KIND_LABELS,
  CloudSavingKind,
  CloudSavingsTotals,
} from "Common/Types/Cloud/CloudCost";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import CloudCostSetupSteps, {
  getCloudProvidersOf,
} from "./CloudCostSetupSteps";
import { PER_MONTH, formatCloudMoney } from "./CloudCostWords";
import { SAVING_RECOMMENDATIONS } from "./CloudOverviewTiles";
import { fetchCloudSavings } from "./CloudSavingsReads";
import { CloudCardFooterLink } from "./CloudSpendCard";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * Cloud Overview's Ways to spend less: what your clouds' own recommenders -
 * AWS Cost Optimization Hub, Azure Advisor, Google Cloud's Recommender -
 * say could be saved a month, and the largest few, each with the resource
 * it is about, with the way to all of them (Cloud > Savings). Before any
 * account's are read it says what each cloud needs for them to be.
 */

export const SAVINGS_CARD_TITLE: string = translationKey("Ways to spend less");
export const SAVINGS_CARD_DESCRIPTION: string = translationKey(
  "What your clouds' own recommenders say could be saved.",
);
export const SAVINGS_UP_TO: string = translationKey("Up to {{amount}} a month");
export const SAVINGS_NONE_FOUND: string = translationKey(
  "Your clouds' recommenders have nothing to suggest right now.",
);
export const SAVINGS_NOT_READ: string = translationKey(
  "No account's recommendations are read yet. Each cloud needs one thing first:",
);
export const VIEW_SAVINGS: string = translationKey("View all savings");
// The largest few the card lists.
export const SAVINGS_CARD_SHOWN: number = 3;

export interface ComponentProps {
  projectId: ObjectID;
  accounts: Array<CloudAccountRow>;
  savings: CloudSavingsTotals;
  savingsRoute: Route;
}

export function getSavingResourceLine(
  recommendation: CloudCostRecommendation,
): string {
  const resource: string =
    recommendation.cloudResource?.name ||
    recommendation.resourceName ||
    recommendation.resourceId ||
    "";
  const account: string = recommendation.cloudAccount?.name || "";

  return [resource, account]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" · ");
}

const CloudSavingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [top, setTop] = useState<Array<CloudCostRecommendation> | null>(null);
  const [error, setError] = useState<string>("");
  const hasSavings: boolean = props.savings.count > 0;

  useEffect(() => {
    if (!hasSavings) {
      return;
    }

    let ignore: boolean = false;

    fetchCloudSavings({
      projectId: props.projectId,
      query: { currency: props.savings.currency },
      limit: SAVINGS_CARD_SHOWN,
    })
      .then((found: Array<CloudCostRecommendation>): void => {
        if (!ignore) {
          setTop(found);
          setError("");
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [hasSavings, props.savings.currency, props.projectId.toString()]);

  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: props.savings.currency,
      translator,
    });
  };

  if (!hasSavings) {
    const anyRead: boolean = props.savings.accountsRead > 0;

    return (
      <Card title={SAVINGS_CARD_TITLE} description={SAVINGS_CARD_DESCRIPTION}>
        <div
          data-testid="cloud-savings-card"
          data-state={anyRead ? "none" : "not-read"}
        >
          {anyRead ? (
            <p className="text-sm text-gray-600">
              {translator.translateText(SAVINGS_NONE_FOUND)}
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-gray-600">
                {translator.translateText(SAVINGS_NOT_READ)}
              </p>
              <CloudCostSetupSteps
                kind="savings"
                providers={getCloudProvidersOf(props.accounts)}
              />
            </>
          )}
          <CloudCardFooterLink
            to={props.savingsRoute}
            text={VIEW_SAVINGS}
            testId="cloud-savings-card-link"
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title={SAVINGS_CARD_TITLE} description={SAVINGS_CARD_DESCRIPTION}>
      <div data-testid="cloud-savings-card" data-state="found">
        <div className="text-2xl font-semibold text-emerald-700">
          {translator.translateTemplate(SAVINGS_UP_TO, {
            amount: money(props.savings.monthlySavings),
          })}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {translator.translatePlural(
            SAVING_RECOMMENDATIONS,
            props.savings.count,
          )}
        </div>
        {error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : top && top.length > 0 ? (
          <ul
            className="mt-5 divide-y divide-gray-100 border-t border-gray-100"
            data-testid="cloud-savings-top"
          >
            {top.map(
              (recommendation: CloudCostRecommendation): ReactElement => {
                const kind: CloudSavingKind =
                  (recommendation.kind as CloudSavingKind) ||
                  CloudSavingKind.Other;
                const resourceLine: string =
                  getSavingResourceLine(recommendation);
                const label: ReactElement = (
                  <span className="block break-words text-sm font-medium text-gray-900">
                    {recommendation.action ||
                      translator.translateText(CLOUD_SAVING_KIND_LABELS[kind])}
                  </span>
                );

                return (
                  <li
                    key={recommendation._id?.toString() || resourceLine}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-3"
                    data-testid="cloud-savings-top-row"
                  >
                    <div className="min-w-0">
                      {recommendation.cloudResourceId ? (
                        <AppLink
                          to={RouteUtil.populateRouteParams(
                            RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                            {
                              modelId: new ObjectID(
                                recommendation.cloudResourceId.toString(),
                              ),
                            },
                          )}
                          className="hover:underline"
                        >
                          {label}
                        </AppLink>
                      ) : (
                        label
                      )}
                      {resourceLine ? (
                        <bdi className="mt-0.5 block truncate text-xs text-gray-500">
                          {resourceLine}
                        </bdi>
                      ) : (
                        <></>
                      )}
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-semibold tabular-nums text-emerald-700">
                        <bdi>
                          {money(Number(recommendation.monthlySavings) || 0)}
                        </bdi>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {translator.translateText(PER_MONTH)}
                      </div>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
        <CloudCardFooterLink
          to={props.savingsRoute}
          text={VIEW_SAVINGS}
          testId="cloud-savings-card-link"
        />
      </div>
    </Card>
  );
};

export default CloudSavingsCard;
