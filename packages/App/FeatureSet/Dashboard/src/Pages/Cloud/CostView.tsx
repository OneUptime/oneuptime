import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import {
  CloudCostPeriod,
  getCloudCostPeriodWindow,
} from "../../Components/Cloud/CloudCostBreakdown";
import CloudCostAddToGroupModal, {
  CloudCostUnallocatedPick,
} from "../../Components/Cloud/CostGroups/CloudCostAddToGroupModal";
import {
  fetchCloudCostAllocation,
  makeCloudCostGroups,
  readGroupRules,
} from "../../Components/Cloud/CostGroups/CloudCostAllocationReads";
import {
  COST_GROUP_PLURAL,
  COST_GROUP_SINGULAR,
  GROUPING_LABELS,
  GROUPS_DESCRIPTION,
  GROUPS_EMPTY,
  GROUPS_MADE,
  GROUPS_MADE_AUTOMATICALLY,
  GROUPS_TITLE,
  GROUP_RULES_DESCRIPTION,
  GROUP_RULES_TITLE,
  MADE_BY_ONEUPTIME,
  MAKE_GROUPS_NOW,
  NEVER_MATCHES,
  NO_GROUPS_TO_MAKE,
  SHARED,
  SHARED_SPLIT_LABELS,
  TAKEN_EARLIER,
} from "../../Components/Cloud/CostGroups/CloudCostGroupWords";
import CloudCostPercentagesEditor from "../../Components/Cloud/CostGroups/CloudCostPercentagesEditor";
import CloudCostRuleEditor from "../../Components/Cloud/CostGroups/CloudCostRuleEditor";
import CloudCostRuleSummary from "../../Components/Cloud/CostGroups/CloudCostRuleSummary";
import CloudCostSpendByGroupCard from "../../Components/Cloud/CostGroups/CloudCostSpendByGroupCard";
import CloudCostUnallocatedCard from "../../Components/Cloud/CostGroups/CloudCostUnallocatedCard";
import useCloudCostRuleContext, {
  CloudCostRuleContext,
} from "../../Components/Cloud/CostGroups/UseCloudCostRuleContext";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Team from "Common/Models/DatabaseModels/Team";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
  CloudCostSharedPercentages,
  CloudCostSharedSplit,
  CloudCostViewGrouping,
} from "Common/Types/Cloud/CloudCostAllocation";
import { CloudCostRule } from "Common/Types/Cloud/CloudCostRules";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A COST VIEW'S OWN PAGE: what each of its groups was charged in a period
 * (CloudCostSpendByGroupCard), what no rule matches yet and the way to add
 * it to a group (CloudCostUnallocatedCard), and the groups themselves, in
 * the order a cost is tried against them - dragged into place, each with
 * its rules as sentences, created and edited with the rule editor.
 */

export const COST_VIEW_TITLE: string = translationKey("Cost View");

const SPLIT_OPTIONS: Array<DropdownOption> = Object.values(
  CloudCostSharedSplit,
).map((split: CloudCostSharedSplit): DropdownOption => {
  return { value: split, label: SHARED_SPLIT_LABELS[split] };
});

const CloudCostViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const viewId: ObjectID = new ObjectID(
    Navigation.getParamByName(
      RouteParams.ModelID,
      RouteMap[PageMap.CLOUD_COST_VIEW] as Route,
    ) || "",
  );
  const accounts: CloudAccountsRead = useCloudAccounts();
  const currency: string = accounts.totals.costs.currency;
  const ruleContext: CloudCostRuleContext = useCloudCostRuleContext({
    accounts: accounts.accounts,
    currency,
  });
  const [view, setView] = useState<CloudCostView | null>(null);
  const [viewError, setViewError] = useState<string>("");
  const [period, setPeriod] = useState<CloudCostPeriod>(
    CloudCostPeriod.ThisMonth,
  );
  const [allocation, setAllocation] =
    useState<CloudCostAllocationResult | null>(null);
  const [allocationError, setAllocationError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [groups, setGroups] = useState<Array<CloudCostGroup>>([]);
  const [pick, setPick] = useState<CloudCostUnallocatedPick | null>(null);
  const [refreshGroups, setRefreshGroups] = useState<string>("0");
  const [isMaking, setIsMaking] = useState<boolean>(false);
  const moreFields: FormFieldCollapsibleSection<CloudCostGroup> =
    getAdvancedFormSection<CloudCostGroup>();

  useEffect(() => {
    ModelAPI.getItem<CloudCostView>({
      modelType: CloudCostView,
      id: viewId,
      select: {
        _id: true,
        name: true,
        description: true,
        grouping: true,
        tagKey: true,
        groupsMadeAt: true,
      },
    })
      .then((found: CloudCostView | null): void => {
        setView(found);
      })
      .catch((err: Error): void => {
        setViewError(API.getFriendlyMessage(err));
      });
  }, [viewId.toString()]);

  useEffect(() => {
    let ignore: boolean = false;
    const window: { start: Date; end: Date } = getCloudCostPeriodWindow(
      period,
      OneUptimeDate.getCurrentDate(),
    );

    setAllocation(null);
    setAllocationError("");

    fetchCloudCostAllocation({
      viewId,
      ask: { startDate: window.start, endDate: window.end, currency },
    })
      .then((found: CloudCostAllocationResult): void => {
        if (!ignore) {
          setAllocation(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setAllocationError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [viewId.toString(), period, currency, attempt]);

  if (viewError) {
    return <ErrorMessage message={viewError} />;
  }

  if (!view) {
    return <PageSkeleton />;
  }

  const isAutomatic: boolean =
    view.grouping === CloudCostViewGrouping.TagValue ||
    view.grouping === CloudCostViewGrouping.OwnerTeam;
  const resultOf: (
    group: CloudCostGroup,
  ) => CloudCostAllocationGroupResult | undefined = (
    group: CloudCostGroup,
  ): CloudCostAllocationGroupResult | undefined => {
    return allocation?.groups.find(
      (entry: CloudCostAllocationGroupResult): boolean => {
        return entry.id === group._id?.toString().toLowerCase();
      },
    );
  };
  const nameOf: (groupId: string) => string = (groupId: string): string => {
    return (
      groups.find((group: CloudCostGroup): boolean => {
        return group._id?.toString().toLowerCase() === groupId;
      })?.name || ""
    );
  };
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: allocation?.currency || currency,
      translator,
    });
  };

  const makeGroups: () => Promise<void> = async (): Promise<void> => {
    setIsMaking(true);

    try {
      const made: number = await makeCloudCostGroups(viewId);

      Toast.success(
        made > 0
          ? translator.translatePlural(GROUPS_MADE, made)
          : translator.translateText(NO_GROUPS_TO_MAKE) || NO_GROUPS_TO_MAKE,
      );
      setRefreshGroups(String(Number(refreshGroups) + 1));
      setAttempt(attempt + 1);
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    } finally {
      setIsMaking(false);
    }
  };

  return (
    <Fragment>
      <Card
        title={COST_VIEW_TITLE}
        description={
          isAutomatic
            ? GROUPS_MADE_AUTOMATICALLY
            : view.description || undefined
        }
        buttons={
          isAutomatic
            ? [
                {
                  title: MAKE_GROUPS_NOW,
                  icon: IconProp.Refresh,
                  isLoading: isMaking,
                  onClick: () => {
                    void makeGroups();
                  },
                },
              ]
            : []
        }
      >
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="cloud-cost-view-header"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            <bdi>{view.name}</bdi>
          </h2>
          <Pill
            text={
              translator.translateText(
                GROUPING_LABELS[view.grouping || CloudCostViewGrouping.Rules],
              ) || ""
            }
            isUserContent={true}
            tone={PillTone.Neutral}
            isDotHidden={true}
          />
          {view.grouping === CloudCostViewGrouping.TagValue && view.tagKey ? (
            <Pill
              text={view.tagKey}
              isUserContent={true}
              tone={PillTone.Info}
              icon={IconProp.Tag}
            />
          ) : (
            <></>
          )}
        </div>
      </Card>
      <CloudCostSpendByGroupCard
        viewId={viewId}
        period={period}
        onPeriodChange={setPeriod}
        allocation={allocation}
        error={allocationError}
        onRetry={() => {
          setAttempt(attempt + 1);
        }}
      />
      {allocation ? (
        <CloudCostUnallocatedCard
          unallocated={allocation.unallocated}
          currency={allocation.currency}
          names={ruleContext.names}
          canEdit={true}
          onPick={setPick}
        />
      ) : (
        <></>
      )}
      <ModelTable<CloudCostGroup>
        modelType={CloudCostGroup}
        singularName={COST_GROUP_SINGULAR}
        pluralName={COST_GROUP_PLURAL}
        id="cloud-cost-groups-table"
        userPreferencesKey="cloud-cost-groups-table"
        name="Cloud > Cost Groups > View > Groups"
        query={{ cloudCostViewId: viewId }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        refreshToggle={refreshGroups}
        enableDragAndDrop={true}
        dragDropIndexField="order"
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: GROUPS_TITLE,
          description: GROUPS_DESCRIPTION,
        }}
        noItemsMessage={GROUPS_EMPTY}
        onBeforeCreate={async (
          item: CloudCostGroup,
        ): Promise<CloudCostGroup> => {
          item.cloudCostViewId = viewId;
          return item;
        }}
        onFetchSuccess={(data: Array<CloudCostGroup>) => {
          setGroups(data);
        }}
        onViewPage={async (item: CloudCostGroup): Promise<Route> => {
          return RouteUtil.populateRouteParams(
            RouteMap[PageMap.CLOUD_COST_GROUP_VIEW] as Route,
            {
              modelId: viewId,
              subModelId: new ObjectID(item._id!.toString()),
            },
          );
        }}
        createInitialValues={{
          rules: [],
          isShared: false,
          sharedSplit: CloudCostSharedSplit.Proportional,
        }}
        selectMoreFields={{
          rules: true,
          isShared: true,
          sharedSplit: true,
          automaticKey: true,
          teamId: true,
          team: { name: true },
          description: true,
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
            getElement: (item: CloudCostGroup): ReactElement => {
              const result: CloudCostAllocationGroupResult | undefined =
                resultOf(item);
              const takenEarlier: number =
                result && result.wouldMatch !== undefined
                  ? result.wouldMatch - result.cloud
                  : 0;

              return (
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-medium text-gray-900">
                      <bdi>{item.name}</bdi>
                    </span>
                    {item.isShared ? (
                      <Pill
                        text={translator.translateText(SHARED) || SHARED}
                        isUserContent={true}
                        tone={PillTone.Info}
                        isDotHidden={true}
                      />
                    ) : (
                      <></>
                    )}
                    {item.automaticKey ? (
                      <Pill
                        text={
                          translator.translateText(MADE_BY_ONEUPTIME) ||
                          MADE_BY_ONEUPTIME
                        }
                        isUserContent={true}
                        tone={PillTone.Neutral}
                        isDotHidden={true}
                      />
                    ) : (
                      <></>
                    )}
                    {item.team?.name ? (
                      <Pill
                        text={item.team.name}
                        isUserContent={true}
                        tone={PillTone.Neutral}
                        icon={IconProp.Team}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                  {result ? (
                    <div className="text-xs text-gray-600">
                      {money(result.total)}
                    </div>
                  ) : (
                    <></>
                  )}
                  {result?.coveredByGroupId ? (
                    <div
                      className="text-xs text-amber-700"
                      data-testid="cloud-cost-group-never-matches"
                    >
                      {translator.translateTemplate(NEVER_MATCHES, {
                        group: nameOf(result.coveredByGroupId),
                      })}
                    </div>
                  ) : takenEarlier >= 0.005 ? (
                    <div
                      className="text-xs text-gray-500"
                      data-testid="cloud-cost-group-taken-earlier"
                    >
                      {translator.translateTemplate(TAKEN_EARLIER, {
                        amount: money(takenEarlier),
                      })}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { rules: true },
            title: "Rules",
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: CloudCostGroup): ReactElement => {
              return (
                <CloudCostRuleSummary
                  rules={readGroupRules(item)}
                  names={ruleContext.names}
                />
              );
            },
          },
        ]}
        /*
         * Two steps: what the group is and whose spend it is, then which
         * costs are its own - and, folded, whether it is shared and how.
         */
        formSteps={[
          { title: "Cost Group", id: "group" },
          { title: "Rules", id: "rules" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "group",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Payments",
            validation: { minLength: 1 },
          },
          {
            field: { team: true },
            title: "Team",
            stepId: "group",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "The team whose spend this is. The group's page shows its spend alone, to share with the team.",
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "group",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What this group is.",
          },
          {
            field: { rules: true },
            title: GROUP_RULES_TITLE,
            stepId: "rules",
            description: GROUP_RULES_DESCRIPTION,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              _values: FormValues<CloudCostGroup>,
              props: CustomElementProps,
            ): ReactElement => {
              return (
                <CloudCostRuleEditor
                  value={(props.initialValue as Array<CloudCostRule>) || []}
                  onChange={(rules: Array<CloudCostRule>) => {
                    props.onChange?.(rules);
                  }}
                  names={ruleContext.names}
                  options={ruleContext.options}
                  showProblem={Boolean(props.error)}
                />
              );
            },
          },
          {
            field: { isShared: true },
            title: "Shared",
            stepId: "rules",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Split this group's costs across the view's other groups, as a support plan or a shared cluster.",
          },
          {
            field: { sharedSplit: true },
            title: "Split",
            stepId: "rules",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: SPLIT_OPTIONS,
            required: false,
            description:
              "How its costs are split: evenly, by each group's share of spend, by fixed percentages, or by Kubernetes namespace.",
            showIf: (values: FormValues<CloudCostGroup>): boolean => {
              return Boolean(values.isShared);
            },
          },
          {
            field: { sharedPercentages: true },
            title: "Percentages",
            stepId: "rules",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            showIf: (values: FormValues<CloudCostGroup>): boolean => {
              return (
                Boolean(values.isShared) &&
                values.sharedSplit === CloudCostSharedSplit.Fixed
              );
            },
            getCustomElement: (
              values: FormValues<CloudCostGroup>,
              props: CustomElementProps,
            ): ReactElement => {
              const ownId: string = String(
                (values as { _id?: unknown })._id || "",
              ).toLowerCase();

              return (
                <CloudCostPercentagesEditor
                  groups={groups.filter((group: CloudCostGroup): boolean => {
                    return (
                      !group.isShared &&
                      group._id?.toString().toLowerCase() !== ownId
                    );
                  })}
                  value={
                    (props.initialValue as CloudCostSharedPercentages) || {}
                  }
                  onChange={(value: CloudCostSharedPercentages) => {
                    props.onChange?.(value);
                  }}
                />
              );
            },
          },
          {
            field: { kubernetesCluster: true },
            title: "Kubernetes Cluster",
            stepId: "rules",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: KubernetesCluster,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "The cluster whose namespaces' costs split this group, each namespace to the group its labels match.",
            showIf: (values: FormValues<CloudCostGroup>): boolean => {
              return (
                Boolean(values.isShared) &&
                values.sharedSplit === CloudCostSharedSplit.Kubernetes
              );
            },
          },
        ]}
      />
      {pick ? (
        <CloudCostAddToGroupModal
          viewId={viewId}
          groups={groups}
          pick={pick}
          names={ruleContext.names}
          onClose={() => {
            setPick(null);
          }}
          onAdded={() => {
            setPick(null);
            setRefreshGroups(String(Number(refreshGroups) + 1));
            setAttempt(attempt + 1);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CloudCostViewPage;
