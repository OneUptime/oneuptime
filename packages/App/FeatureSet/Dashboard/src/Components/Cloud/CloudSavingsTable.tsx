import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  Blue500,
  Emerald500,
  Gray500,
  Orange500,
  Violet500,
} from "Common/Types/BrandColors";
import {
  CLOUD_SAVING_KIND_LABELS,
  CloudSavingKind,
  getCloudSavingActionText,
} from "Common/Types/Cloud/CloudCost";
import {
  CloudProvider,
  getCloudProviderLabel,
} from "Common/Types/Cloud/CloudPlatform";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { formatCloudMoney } from "./CloudCostWords";
import {
  SAVING_NOT_KNOWN_YET,
  getCloudRightSizingEvidenceLine,
  isCloudSavingAmountKnown,
} from "./CloudRightSizingText";
import { readCloudRightSizingEvidence } from "Common/Types/Cloud/CloudRightSizing";
import { joinWithArrowsOn } from "Common/Types/DirectionArrow";

/*
 * The ways to spend less, as a table: every recommendation your clouds'
 * own recommenders make - AWS Cost Optimization Hub, Azure Advisor, Google
 * Cloud's Recommender - the largest saving first. A row reads left to
 * right as a person says it: what to do and what it changes ("Rightsize",
 * "m5.2xlarge → m5.xlarge"), to which resource (its page, when OneUptime
 * holds it), what it saves a month and in which account. What it changes
 * sits under what to do, so a phone - where a table keeps its first few
 * columns - shows it too. The kind (a smaller size, an idle resource, a
 * commitment) is the strip's and the Kind filter's: a column of it only
 * said the action's word again ("Rightsize", "Rightsize"), so it waits in
 * the table's column picker. On Cloud > Savings for every account, and on
 * an account's Costs for it. The recommendations are the server's
 * (CloudCostRecommendation is read only), read again every day: one done
 * or dismissed in the cloud's console goes away on the next read.
 */

export const SAVINGS_TABLE_TITLE: string = translationKey("Ways to spend less");
export const SAVINGS_TABLE_DESCRIPTION: string = translationKey(
  "What your clouds' recommenders and OneUptime's own right-sizing say could be saved, the largest first. Read every day: one acted on or dismissed goes away on the next read.",
);
export const SAVINGS_TABLE_EMPTY: string = translationKey(
  "No ways to spend less yet. Your clouds' recommenders are read once a day.",
);

export const CLOUD_SAVING_KIND_COLORS: Readonly<
  Record<CloudSavingKind, Color>
> = {
  [CloudSavingKind.Rightsize]: Blue500,
  [CloudSavingKind.Idle]: Orange500,
  [CloudSavingKind.Upgrade]: Violet500,
  [CloudSavingKind.Commitment]: Emerald500,
  [CloudSavingKind.Other]: Gray500,
};

const KIND_OPTIONS: Array<DropdownOption> = Object.values(CloudSavingKind).map(
  (kind: CloudSavingKind): DropdownOption => {
    return { label: CLOUD_SAVING_KIND_LABELS[kind], value: kind };
  },
);

const PROVIDER_OPTIONS: Array<DropdownOption> = Object.values(
  CloudProvider,
).map((provider: CloudProvider): DropdownOption => {
  return { label: getCloudProviderLabel(provider), value: provider };
});

/*
 * "m5.xlarge → m5.large": what it would change, when the recommender says,
 * in a line read in `language`. Each configuration keeps its own reading
 * and the arrow points the way the page reads (joinWithArrowsOn).
 */
export function getSavingChangeText(
  recommendation: CloudCostRecommendation,
  language: string,
): string {
  const from: string = (recommendation.currentConfiguration || "").trim();
  const to: string = (recommendation.recommendedConfiguration || "").trim();

  return joinWithArrowsOn(
    [from, to].filter((part: string): boolean => {
      return part.length > 0;
    }),
    language,
  );
}

export interface ComponentProps {
  id: string;
  // One account's; every account's when absent.
  cloudAccountId?: ObjectID | undefined;
  // The currency a row is in when it names none.
  currency: string;
}

const CloudSavingsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isOneAccount: boolean = Boolean(props.cloudAccountId);

  return (
    <ModelTable<CloudCostRecommendation>
      modelType={CloudCostRecommendation}
      id={props.id}
      userPreferencesKey={props.id}
      name="Cloud > Savings"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      query={
        (props.cloudAccountId
          ? { cloudAccountId: props.cloudAccountId }
          : {}) as Query<CloudCostRecommendation>
      }
      sortBy="monthlySavings"
      sortOrder={SortOrder.Descending}
      selectMoreFields={{
        currency: true,
        // What an empty action is drawn as (getCloudSavingActionText).
        kind: true,
        resourceName: true,
        resourceId: true,
        resourceType: true,
        cloudResourceId: true,
        cloudAccountId: true,
        currentConfiguration: true,
        recommendedConfiguration: true,
        region: true,
        provider: true,
        // What made OneUptime's own right-sizing, said under its change.
        evidence: true,
      }}
      cardProps={{
        title: SAVINGS_TABLE_TITLE,
        description: SAVINGS_TABLE_DESCRIPTION,
      }}
      noItemsMessage={SAVINGS_TABLE_EMPTY}
      filters={[
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Dropdown,
          filterDropdownOptions: KIND_OPTIONS,
        },
        ...(isOneAccount
          ? []
          : [
              {
                field: { cloudAccount: { name: true } },
                title: "Account",
                type: FieldType.Entity,
                filterEntityType: CloudAccount,
                filterDropdownField: { label: "name", value: "_id" },
              },
              {
                field: { provider: true },
                title: "Cloud",
                type: FieldType.Dropdown,
                filterDropdownOptions: PROVIDER_OPTIONS,
              },
            ]),
        {
          field: { resourceName: true },
          title: "Resource",
          type: FieldType.Text,
        },
        {
          field: { region: true },
          title: "Region",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: { action: true },
          title: "Recommendation",
          type: FieldType.Element,
          isNotCustomizable: true,
          wrapContent: true,
          getElement: (item: CloudCostRecommendation): ReactElement => {
            const change: string = getSavingChangeText(
              item,
              translator.language,
            );
            const evidence: string | null = getCloudRightSizingEvidenceLine({
              evidence: readCloudRightSizingEvidence(item.evidence),
              translator,
            });

            return (
              <div className="min-w-0" data-testid="cloud-saving-row">
                <div className="break-words text-sm font-medium text-gray-900">
                  {getCloudSavingActionText({
                    action: item.action,
                    kind: item.kind as CloudSavingKind | undefined,
                    translateText: translator.translateText,
                  })}
                </div>
                {change ? (
                  <div
                    className="mt-0.5 break-words text-xs text-gray-500"
                    data-testid="cloud-saving-change"
                  >
                    {change}
                  </div>
                ) : (
                  <></>
                )}
                {/*
                 * OneUptime's own right-sizing says what it was judged
                 * from, in the reader's language: a cloud's recommender
                 * says that in its own console.
                 */}
                {evidence ? (
                  <div
                    className="mt-0.5 break-words text-xs text-gray-500"
                    data-testid="cloud-saving-evidence"
                  >
                    {evidence}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { resourceName: true },
          title: "Resource",
          type: FieldType.Element,
          wrapContent: true,
          getElement: (item: CloudCostRecommendation): ReactElement => {
            const resource: string = item.resourceName || item.resourceId || "";
            const where: string = [item.resourceType || "", item.region || ""]
              .filter((part: string): boolean => {
                return part.length > 0;
              })
              .join(" · ");

            return (
              <div className="min-w-0" data-testid="cloud-saving-resource">
                {resource ? (
                  <div className="break-all text-sm">
                    {item.cloudResourceId ? (
                      <AppLink
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                          {
                            modelId: new ObjectID(
                              item.cloudResourceId.toString(),
                            ),
                          },
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        <bdi>{resource}</bdi>
                      </AppLink>
                    ) : (
                      <bdi className="text-gray-900">{resource}</bdi>
                    )}
                  </div>
                ) : (
                  <></>
                )}
                {where ? (
                  <div className="mt-0.5 text-xs text-gray-500">
                    <bdi>{where}</bdi>
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          field: { monthlySavings: true },
          title: "Monthly Savings",
          type: FieldType.Element,
          getElement: (item: CloudCostRecommendation): ReactElement => {
            /*
             * OneUptime's own right-sizing of a resource its cloud does not
             * bill by name has no amount yet: said so, not as nothing.
             */
            if (!isCloudSavingAmountKnown(item)) {
              return (
                <span
                  className="text-sm text-gray-500"
                  data-testid="cloud-saving-amount-not-known"
                >
                  {translator.translateText(SAVING_NOT_KNOWN_YET)}
                </span>
              );
            }

            return (
              <span
                className="text-sm font-semibold tabular-nums text-emerald-700"
                data-testid="cloud-saving-amount"
              >
                <bdi>
                  {formatCloudMoney({
                    amount: Number(item.monthlySavings) || 0,
                    currency: item.currency || props.currency,
                    translator,
                  })}
                </bdi>
              </span>
            );
          },
        },
        ...(isOneAccount
          ? []
          : [
              {
                field: { cloudAccount: { name: true } },
                title: "Account",
                type: FieldType.Element,
                hideOnMobile: true,
                getElement: (item: CloudCostRecommendation): ReactElement => {
                  if (!item.cloudAccountId) {
                    return <></>;
                  }

                  return (
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                        {
                          modelId: new ObjectID(item.cloudAccountId.toString()),
                        },
                      )}
                      className="break-words text-sm text-gray-900 hover:underline"
                    >
                      {item.cloudAccount?.name || ""}
                    </AppLink>
                  );
                },
              },
            ]),
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Element,
          hideOnMobile: true,
          isHiddenByDefault: true,
          getElement: (item: CloudCostRecommendation): ReactElement => {
            const kind: CloudSavingKind =
              (item.kind as CloudSavingKind) || CloudSavingKind.Other;

            return (
              <Pill
                text={CLOUD_SAVING_KIND_LABELS[kind]}
                color={CLOUD_SAVING_KIND_COLORS[kind]}
              />
            );
          },
        },
        {
          field: { source: true },
          title: "Source",
          type: FieldType.Text,
          hideOnMobile: true,
          isHiddenByDefault: true,
        },
        {
          field: { effort: true },
          title: "Effort",
          type: FieldType.Text,
          hideOnMobile: true,
          isHiddenByDefault: true,
        },
      ]}
    />
  );
};

export default CloudSavingsTable;
