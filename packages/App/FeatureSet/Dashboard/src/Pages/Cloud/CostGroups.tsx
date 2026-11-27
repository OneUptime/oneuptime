import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CloudCostQuickStart from "../../Components/Cloud/CostGroups/CloudCostQuickStart";
import {
  COST_GROUPS_DESCRIPTION,
  COST_GROUPS_TITLE,
  COST_VIEWS_EMPTY,
  COST_VIEW_PLURAL,
  COST_VIEW_SINGULAR,
  LINE_ITEM_PLURAL,
  LINE_ITEM_SINGULAR,
  GROUPING_LABELS,
  LINE_ITEMS_DESCRIPTION,
  LINE_ITEMS_EMPTY,
  LINE_ITEMS_TITLE,
  LINE_ITEM_EACH_MONTH,
  LINE_ITEM_KIND_LABELS,
  LINE_ITEM_RECURRENCE_LABELS,
} from "../../Components/Cloud/CostGroups/CloudCostGroupWords";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import { mergeCloudCostTagKeys } from "../../Components/Cloud/CloudCostReads";
import useCloudAccounts, {
  CloudAccountRow,
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostLineItem from "Common/Models/DatabaseModels/CloudCostLineItem";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
  CloudCostViewGrouping,
} from "Common/Types/Cloud/CloudCostAllocation";
import ObjectID from "Common/Types/ObjectID";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import FieldType from "Common/UI/Components/Types/FieldType";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * Cloud > Spend > Cost Groups: the ways the project's spend is sorted into
 * teams, products and cost centers (cost views), and the charges and
 * credits its clouds' bills do not carry (custom line items).
 *
 * A project with no view yet is offered the three ways most teams start,
 * one click each (CloudCostQuickStart). Each view opens its own page: its
 * groups, what each was charged, and what no rule matches yet.
 */

const GROUPING_OPTIONS: Array<DropdownOption> = Object.values(
  CloudCostViewGrouping,
).map((grouping: CloudCostViewGrouping): DropdownOption => {
  return { value: grouping, label: GROUPING_LABELS[grouping] };
});

const KIND_OPTIONS: Array<DropdownOption> = Object.values(
  CloudCostLineItemKind,
).map((kind: CloudCostLineItemKind): DropdownOption => {
  return { value: kind, label: LINE_ITEM_KIND_LABELS[kind] };
});

const RECURRENCE_OPTIONS: Array<DropdownOption> = Object.values(
  CloudCostLineItemRecurrence,
).map((recurrence: CloudCostLineItemRecurrence): DropdownOption => {
  return { value: recurrence, label: LINE_ITEM_RECURRENCE_LABELS[recurrence] };
});

/*
 * Who may start a view (Quick Start creates one, and its groups follow):
 * whoever the server lets create a cost view, by its own rule - a team's
 * block row refuses, as it refuses the create (PermissionGate).
 */
function canCreateCostViews(): boolean {
  return PermissionGate.check(new CloudCostView(), ModelAction.Create)
    .isAllowed;
}

const CloudCostGroups: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const read: CloudAccountsRead = useCloudAccounts();
  const currency: string = read.totals.costs.currency;
  const [viewCount, setViewCount] = useState<number | null>(null);
  const moreViewFields: FormFieldCollapsibleSection<CloudCostView> =
    getAdvancedFormSection<CloudCostView>();
  const moreItemFields: FormFieldCollapsibleSection<CloudCostLineItem> =
    getAdvancedFormSection<CloudCostLineItem>();

  const tagKeys: Array<string> = useMemo((): Array<string> => {
    return mergeCloudCostTagKeys({
      summaries: read.accounts.map((account: CloudAccountRow) => {
        return account.costSummary;
      }),
      currency,
    }).map((entry: { key: string }): string => {
      return entry.key;
    });
  }, [read.accounts, currency]);

  const money: (amount: number, itemCurrency?: string) => string = (
    amount: number,
    itemCurrency?: string,
  ): string => {
    return formatCloudMoney({
      amount,
      currency: itemCurrency || currency,
      translator,
      wholeWhenRound: true,
    });
  };

  return (
    <Fragment>
      {viewCount === 0 ? (
        <CloudCostQuickStart
          tagKeys={tagKeys}
          canCreate={canCreateCostViews()}
        />
      ) : (
        <></>
      )}
      <ModelTable<CloudCostView>
        modelType={CloudCostView}
        singularName={COST_VIEW_SINGULAR}
        pluralName={COST_VIEW_PLURAL}
        id="cloud-cost-views-table"
        userPreferencesKey="cloud-cost-views-table"
        name="Cloud > Cost Groups"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: COST_GROUPS_TITLE,
          description: COST_GROUPS_DESCRIPTION,
        }}
        noItemsMessage={COST_VIEWS_EMPTY}
        onFetchSuccess={(data: Array<CloudCostView>, totalCount: number) => {
          setViewCount(totalCount ?? data.length);
        }}
        onViewPage={async (item: CloudCostView): Promise<Route> => {
          return RouteUtil.populateRouteParams(
            RouteMap[PageMap.CLOUD_COST_VIEW] as Route,
            { modelId: new ObjectID(item._id!.toString()) },
          );
        }}
        createInitialValues={{
          grouping: CloudCostViewGrouping.Rules,
        }}
        selectMoreFields={{
          description: true,
          tagKey: true,
          grouping: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            getLineText: drawsItsOwnLines,
            getElement: (item: CloudCostView): ReactElement => {
              return (
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-gray-900">
                    <bdi>{item.name}</bdi>
                  </div>
                  {item.description ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                      <bdi>{item.description}</bdi>
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { grouping: true },
            title: "Groups",
            type: FieldType.Element,
            disableSort: true,
            getElement: (item: CloudCostView): ReactElement => {
              const grouping: CloudCostViewGrouping =
                item.grouping || CloudCostViewGrouping.Rules;

              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-700">
                    {translator.translateText(GROUPING_LABELS[grouping])}
                  </span>
                  {grouping === CloudCostViewGrouping.TagValue &&
                  item.tagKey ? (
                    <Pill
                      text={item.tagKey}
                      isUserContent={true}
                      tone={PillTone.Neutral}
                      isDotHidden={true}
                    />
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
        /*
         * Two steps: what the view is called, then how its groups are made
         * (and, for a group per tag value, which tag).
         */
        formSteps={[
          { title: "Cost View", id: "view" },
          { title: "Groups", id: "groups" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "view",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "By team",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "view",
            collapsibleSection: moreViewFields,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What this view sorts the spend by.",
          },
          {
            field: { grouping: true },
            title: "Groups",
            stepId: "groups",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: GROUPING_OPTIONS,
            required: true,
            description:
              "Write each group's rules, or let OneUptime make a group per tag value or per owner team.",
          },
          {
            field: { tagKey: true },
            title: "Tag Key",
            stepId: "groups",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: tagKeys[0] || "team",
            description: "The tag whose values each get a group.",
            showIf: (values: FormValues<CloudCostView>): boolean => {
              return values.grouping === CloudCostViewGrouping.TagValue;
            },
          },
        ]}
      />
      <ModelTable<CloudCostLineItem>
        modelType={CloudCostLineItem}
        singularName={LINE_ITEM_SINGULAR}
        pluralName={LINE_ITEM_PLURAL}
        id="cloud-cost-line-items-table"
        userPreferencesKey="cloud-cost-line-items-table"
        name="Cloud > Cost Groups > Custom Line Items"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: LINE_ITEMS_TITLE,
          description: LINE_ITEMS_DESCRIPTION,
        }}
        noItemsMessage={LINE_ITEMS_EMPTY}
        createInitialValues={{
          kind: CloudCostLineItemKind.Charge,
          recurrence: CloudCostLineItemRecurrence.Monthly,
          currency,
        }}
        selectMoreFields={{
          kind: true,
          recurrence: true,
          currency: true,
          startDate: true,
          endDate: true,
          description: true,
          cloudAccountId: true,
          cloudCostGroupId: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            getLineText: drawsItsOwnLines,
            getElement: (item: CloudCostLineItem): ReactElement => {
              return (
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium text-gray-900">
                    <bdi>{item.name}</bdi>
                  </div>
                  {item.description ? (
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                      <bdi>{item.description}</bdi>
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { amount: true },
            title: "Amount",
            type: FieldType.Element,
            getElement: (item: CloudCostLineItem): ReactElement => {
              const signed: number =
                item.kind === CloudCostLineItemKind.Credit
                  ? -(Number(item.amount) || 0)
                  : Number(item.amount) || 0;
              const amount: string = money(signed, item.currency);

              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-900">
                    {item.recurrence === CloudCostLineItemRecurrence.Monthly
                      ? translator.translateTemplate(LINE_ITEM_EACH_MONTH, {
                          amount,
                        })
                      : amount}
                  </span>
                  <Pill
                    text={
                      translator.translateText(
                        LINE_ITEM_KIND_LABELS[
                          item.kind || CloudCostLineItemKind.Charge
                        ],
                      ) ||
                      LINE_ITEM_KIND_LABELS[
                        item.kind || CloudCostLineItemKind.Charge
                      ]
                    }
                    isUserContent={true}
                    tone={
                      item.kind === CloudCostLineItemKind.Credit
                        ? PillTone.Success
                        : PillTone.Neutral
                    }
                    isDotHidden={true}
                  />
                </div>
              );
            },
          },
          {
            field: { startDate: true },
            title: "From",
            type: FieldType.Date,
            hideOnMobile: true,
          },
        ]}
        formSteps={[
          { title: "Line Item", id: "line-item" },
          { title: "When and Where", id: "when-and-where" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "line-item",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Support contract share",
            validation: { minLength: 2 },
          },
          {
            field: { kind: true },
            title: "Kind",
            stepId: "line-item",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: KIND_OPTIONS,
            required: true,
            description: "A credit takes off the spend, such as a discount.",
          },
          {
            field: { amount: true },
            title: "Amount",
            stepId: "line-item",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: true,
            placeholder: "1200",
          },
          {
            field: { recurrence: true },
            title: "Repeats",
            stepId: "line-item",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: RECURRENCE_OPTIONS,
            required: true,
            description:
              "A monthly item is spread over each month's days, so part of a month takes its part.",
          },
          {
            field: { currency: true },
            title: "Currency",
            stepId: "line-item",
            collapsibleSection: moreItemFields,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "USD",
            validation: { minLength: 3, maxLength: 3 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "line-item",
            collapsibleSection: moreItemFields,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Why this line item is added.",
          },
          {
            field: { startDate: true },
            title: "Start Date",
            stepId: "when-and-where",
            fieldType: FormFieldSchemaType.Date,
            required: true,
            description:
              "The day a one-off item is for, or the first month a monthly one counts in.",
          },
          {
            field: { endDate: true },
            title: "End Date",
            stepId: "when-and-where",
            fieldType: FormFieldSchemaType.Date,
            required: false,
            description: "The last month it counts in. Leave empty for no end.",
            showIf: (values: FormValues<CloudCostLineItem>): boolean => {
              return values.recurrence !== CloudCostLineItemRecurrence.Once;
            },
          },
          {
            field: { cloudAccount: true },
            title: "Account",
            stepId: "when-and-where",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: CloudAccount,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Add it to an account: each view sorts it as it sorts the account's costs.",
          },
          {
            field: { cloudCostGroup: true },
            title: "Cost Group",
            stepId: "when-and-where",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: CloudCostGroup,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description: "Or add it straight to one group.",
          },
        ]}
      />
    </Fragment>
  );
};

export default CloudCostGroups;
