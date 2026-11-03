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

/*
 * The ways to spend less, as a table: every recommendation your clouds'
 * own recommenders make - AWS Cost Optimization Hub, Azure Advisor, Google
 * Cloud's Recommender - the largest saving first, each with what it would
 * change and the resource it is about (its page, when OneUptime holds it).
 * On Cloud > Savings for every account, and on an account's Costs for it.
 * The recommendations are the server's (CloudCostRecommendation is read
 * only), read again every day: one done or dismissed in the cloud's console
 * goes away on the next read.
 */

export const SAVINGS_TABLE_TITLE: string = translationKey("Ways to spend less");
export const SAVINGS_TABLE_DESCRIPTION: string = translationKey(
  "What your clouds' own recommenders say could be saved, the largest first. Read again every day: one you act on or dismiss in your cloud's console goes away on the next read.",
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

// "m5.xlarge → m5.large": what it would change, when the recommender says.
export function getSavingChangeText(
  recommendation: CloudCostRecommendation,
): string {
  const from: string = (recommendation.currentConfiguration || "").trim();
  const to: string = (recommendation.recommendedConfiguration || "").trim();

  if (from && to) {
    return `${from} → ${to}`;
  }

  return from || to;
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
        resourceName: true,
        resourceId: true,
        resourceType: true,
        cloudResourceId: true,
        cloudAccountId: true,
        recommendedConfiguration: true,
        region: true,
        provider: true,
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
            const resource: string = item.resourceName || item.resourceId || "";
            const where: string = [item.resourceType || "", item.region || ""]
              .filter((part: string): boolean => {
                return part.length > 0;
              })
              .join(" · ");

            return (
              <div className="min-w-0" data-testid="cloud-saving-row">
                <div className="break-words text-sm font-medium text-gray-900">
                  {item.action || ""}
                </div>
                {resource ? (
                  <div className="mt-0.5 break-all text-xs">
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
                      <bdi className="text-gray-700">{resource}</bdi>
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
          field: { kind: true },
          title: "Kind",
          type: FieldType.Element,
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
          field: { monthlySavings: true },
          title: "Saves a Month",
          type: FieldType.Element,
          getElement: (item: CloudCostRecommendation): ReactElement => {
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
          field: { currentConfiguration: true },
          title: "Change",
          type: FieldType.Element,
          hideOnMobile: true,
          wrapContent: true,
          disableSort: true,
          getElement: (item: CloudCostRecommendation): ReactElement => {
            const change: string = getSavingChangeText(item);

            return change ? (
              <bdi className="break-words text-xs text-gray-700">
                {change}
              </bdi>
            ) : (
              <></>
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
