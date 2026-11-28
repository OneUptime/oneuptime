import PageComponentProps from "../PageComponentProps";
import {
  getCloudCostFileName,
  toCloudCostGroupSpendCsv,
} from "Common/Types/Cloud/CloudCostCsv";
import downloadFile from "Common/UI/Utils/DownloadFile";
import { DOWNLOAD_CSV } from "../../Components/Cloud/CloudCostBreakdownCard";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import AppLink from "../../Components/AppLink/AppLink";
import RankedBars, {
  RankedBarItem,
} from "../../Components/SecurityOverview/RankedBars";
import {
  CLOUD_COST_PERIOD_OPTIONS,
  CloudCostPeriod,
  CloudCostShareLabel,
  getCloudCostPeriodWindow,
  getCloudCostShareLabel,
} from "../../Components/Cloud/CloudCostBreakdown";
import CloudDailySpendChart from "../../Components/Cloud/CloudDailySpendChart";
import CloudStatStrip, {
  CloudStatTile,
} from "../../Components/Cloud/CloudStatStrip";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import {
  CloudCostGroupSpend,
  fetchCloudCostGroupSpend,
  readGroupRules,
} from "../../Components/Cloud/CostGroups/CloudCostAllocationReads";
import { getGroupChangeHint } from "../../Components/Cloud/CostGroups/CloudCostGroupFigures";
import {
  GROUP_RULES_DESCRIPTION,
  GROUP_RULES_TITLE,
  GROUP_SPEND_DESCRIPTION,
  GROUP_SPEND_TITLE,
  GROUP_TOP_ACCOUNTS,
  GROUP_TOP_EMPTY,
  GROUP_TOP_RESOURCES,
  GROUP_TOP_SERVICES,
  LINE_ITEMS,
  PERIOD_BEFORE,
  SHARED,
  SHARED_COSTS,
  SHARED_SPLIT_LABELS,
  SPLIT_ACROSS,
  SPLIT_KEPT,
  THIS_PERIOD,
} from "../../Components/Cloud/CostGroups/CloudCostGroupWords";
import CloudCostRuleEditor from "../../Components/Cloud/CostGroups/CloudCostRuleEditor";
import CloudCostRuleSummary from "../../Components/Cloud/CostGroups/CloudCostRuleSummary";
import useCloudCostRuleContext, {
  CloudCostRuleContext,
} from "../../Components/Cloud/CostGroups/UseCloudCostRuleContext";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import CloudCostBasisSwitch, {
  CloudCostBasisChoice,
  CloudCostBasisPill,
  useCloudCostBasis,
} from "../../Components/Cloud/CloudCostBasis";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import Route from "Common/Types/API/Route";
import {
  CloudCostAllocationShare,
  CloudCostSharedSplit,
} from "Common/Types/Cloud/CloudCostAllocation";
import { fromCloudCostDay } from "Common/Types/Cloud/CloudCost";
import { CloudCostRule } from "Common/Types/Cloud/CloudCostRules";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import RecordActivityLine from "Common/UI/Components/Detail/RecordActivityLine";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
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
 * A COST GROUP'S OWN PAGE: what the group was charged in a period - its
 * own costs, its line items and its share of shared costs, against the
 * period before - day by day, the services, resources and accounts it is
 * charged for most, and its rules. It reads the group alone
 * (POST /cloud-cost-group/:id/spend), so a team member who may read the
 * cloud's spend opens it and sees only their group's.
 */

export const EDIT_RULES: string = translationKey("Edit Rules");
export const SAVE_RULES: string = translationKey("Save Rules");
export const RULES_SAVED: string = translationKey(
  "Rules saved. Every month is sorted again by them.",
);
export const COST_GROUP_TITLE: string = translationKey("Cost Group");

const CloudCostGroupPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const route: Route = RouteMap[PageMap.CLOUD_COST_GROUP_VIEW] as Route;
  const viewId: ObjectID = new ObjectID(
    Navigation.getParamByName(RouteParams.ModelID, route) || "",
  );
  const groupId: ObjectID = new ObjectID(
    Navigation.getParamByName(RouteParams.SubModelID, route) || "",
  );
  const accounts: CloudAccountsRead = useCloudAccounts();
  const currency: string = accounts.totals.costs.currency;
  // The group's spend billed, amortized or net, as Costs shows the spend.
  const basisChoice: CloudCostBasisChoice = useCloudCostBasis();
  const ruleContext: CloudCostRuleContext = useCloudCostRuleContext({
    accounts: accounts.accounts,
    currency,
  });
  const [group, setGroup] = useState<CloudCostGroup | null>(null);
  const [groupError, setGroupError] = useState<string>("");
  const [period, setPeriod] = useState<CloudCostPeriod>(
    CloudCostPeriod.ThisMonth,
  );
  const [spend, setSpend] = useState<CloudCostGroupSpend | null>(null);
  const [spendError, setSpendError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [editing, setEditing] = useState<Array<CloudCostRule> | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  useEffect(() => {
    ModelAPI.getItem<CloudCostGroup>({
      modelType: CloudCostGroup,
      id: groupId,
      select: {
        _id: true,
        name: true,
        description: true,
        rules: true,
        isShared: true,
        sharedSplit: true,
        automaticKey: true,
        teamId: true,
        team: { name: true },
        cloudCostView: { name: true },
      },
    })
      .then((found: CloudCostGroup | null): void => {
        setGroup(found);
      })
      .catch((err: Error): void => {
        setGroupError(API.getFriendlyMessage(err));
      });
  }, [groupId.toString(), attempt]);

  useEffect(() => {
    let ignore: boolean = false;
    const window: { start: Date; end: Date } = getCloudCostPeriodWindow(
      period,
      OneUptimeDate.getCurrentDate(),
    );

    setSpend(null);
    setSpendError("");

    fetchCloudCostGroupSpend({
      groupId,
      ask: {
        startDate: window.start,
        endDate: window.end,
        currency,
        basis: basisChoice.basis,
      },
    })
      .then((found: CloudCostGroupSpend): void => {
        if (!ignore) {
          setSpend(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setSpendError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [groupId.toString(), period, currency, basisChoice.basis, attempt]);

  if (groupError) {
    return <ErrorMessage message={groupError} />;
  }

  if (!group) {
    return <PageSkeleton />;
  }

  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: spend?.currency || currency,
      translator,
    });
  };

  const accountNames: Map<string, string> = ruleContext.names.accounts;
  const tiles: Array<CloudStatTile> = spend
    ? [
        {
          key: "total",
          title: THIS_PERIOD,
          value: money(spend.group.total),
          sublabel:
            getGroupChangeHint({ group: spend.group, translator }) || "",
          sublabelIsTranslated: true,
          icon: IconProp.Billing,
          color: "indigo",
        },
        {
          key: "previous",
          title: PERIOD_BEFORE,
          value:
            spend.group.previousTotal === undefined
              ? undefined
              : money(spend.group.previousTotal),
          icon: IconProp.Calendar,
          color: "sky",
        },
        {
          key: "shared",
          title: group.isShared ? SHARED : SHARED_COSTS,
          value: money(
            group.isShared ? spend.group.sharedOut : spend.group.sharedIn,
          ),
          sublabel: group.isShared
            ? translator.translateText(
                SHARED_SPLIT_LABELS[
                  spend.group.split || CloudCostSharedSplit.Proportional
                ],
              ) || ""
            : "",
          sublabelIsTranslated: true,
          icon: IconProp.Share,
          color: "violet",
        },
        {
          key: "line-items",
          title: LINE_ITEMS,
          value: money(spend.group.lineItems),
          icon: IconProp.ReceiptPercent,
          color: "emerald",
        },
      ]
    : [];

  const toItems: (
    shares: Array<CloudCostAllocationShare> | undefined,
    dimension: "service" | "resourceId" | "cloudAccountId",
  ) => Array<RankedBarItem> = (
    shares: Array<CloudCostAllocationShare> | undefined,
    dimension: "service" | "resourceId" | "cloudAccountId",
  ): Array<RankedBarItem> => {
    return (shares || []).map((share: CloudCostAllocationShare) => {
      const label: CloudCostShareLabel = getCloudCostShareLabel({
        dimension,
        key: share.key,
        accountNames,
      });
      const text: string = label.isAsWritten
        ? label.label
        : translator.translateText(label.label) || label.label;

      return {
        key: share.key || "none",
        label: <bdi>{text}</bdi>,
        title: label.title || text,
        count: share.amount,
        countText: money(share.amount),
      };
    });
  };

  const saveRules: () => Promise<void> = async (): Promise<void> => {
    if (!editing) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await ModelAPI.updateById<CloudCostGroup>({
        modelType: CloudCostGroup,
        id: groupId,
        data: { rules: editing as unknown as JSONObject },
      });
      Toast.success(translator.translateText(RULES_SAVED) || RULES_SAVED);
      setEditing(null);
      setAttempt(attempt + 1);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Fragment>
      <Card
        title={COST_GROUP_TITLE}
        description={group.description || undefined}
      >
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="cloud-cost-group-header"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            <bdi>{group.name}</bdi>
          </h2>
          {group.cloudCostView?.name ? (
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CLOUD_COST_VIEW] as Route,
                { modelId: viewId },
              )}
              className="text-sm text-indigo-600 hover:text-indigo-700 hover:underline"
              dataTestId="cloud-cost-group-view-link"
            >
              <bdi>{group.cloudCostView.name}</bdi>
            </AppLink>
          ) : (
            <></>
          )}
          {group.team?.name ? (
            <Pill
              text={group.team.name}
              isUserContent={true}
              tone={PillTone.Neutral}
              icon={IconProp.Team}
            />
          ) : (
            <></>
          )}
          {group.isShared ? (
            <Pill
              text={translator.translateText(SHARED) || SHARED}
              isUserContent={true}
              tone={PillTone.Info}
              isDotHidden={true}
            />
          ) : (
            <></>
          )}
        </div>
        {/* The group's line: its ID, who created it and who last changed it. */}
        <RecordActivityLine
          modelType={CloudCostGroup}
          recordId={groupId}
          className="mt-4 border-t border-gray-100 pt-3"
        />
      </Card>
      <CloudCostBasisSwitch
        basis={basisChoice.basis}
        onChange={basisChoice.setBasis}
        accounts={accounts.accounts}
      />
      <div>
        <FilterButtons
          ariaLabel="Period"
          className="flex-wrap"
          dataTestId="cloud-cost-group-period"
          options={CLOUD_COST_PERIOD_OPTIONS}
          selectedValue={period}
          onSelect={(value: string) => {
            setPeriod(value as CloudCostPeriod);
          }}
        />
      </div>
      {spendError ? (
        <ErrorMessage
          message={spendError}
          onRefreshClick={() => {
            setAttempt(attempt + 1);
          }}
        />
      ) : spend === null ? (
        <PageSkeleton shape="chart" />
      ) : (
        <Fragment>
          <CloudStatStrip testId="cloud-cost-group-strip" tiles={tiles} />
          {group.isShared && spend.group.sharedOut !== 0 ? (
            <div
              className="space-y-0.5 text-sm text-gray-600"
              data-testid="cloud-cost-group-split"
            >
              <p>
                {translator.translateTemplate(SPLIT_ACROSS, {
                  amount: money(spend.group.sharedOut),
                })}
              </p>
              {Math.abs(spend.group.total) >= 0.005 ? (
                <p>
                  {translator.translateTemplate(SPLIT_KEPT, {
                    amount: money(spend.group.total),
                  })}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
          <Card
            title={GROUP_SPEND_TITLE}
            description={GROUP_SPEND_DESCRIPTION}
            rightElement={
              <CloudCostBasisPill basis={spend.basis || basisChoice.basis} />
            }
            buttons={[
              {
                title: DOWNLOAD_CSV,
                icon: IconProp.Download,
                // Its days, its services, resources and accounts, in one file.
                onClick: () => {
                  downloadFile({
                    content: toCloudCostGroupSpendCsv({
                      group: spend.group,
                      buckets: spend.buckets,
                      start: spend.start,
                      lastDay: spend.lastDay,
                      currency: spend.currency,
                      basis: spend.basis || basisChoice.basis,
                      accountNames,
                    }),
                    filename: getCloudCostFileName({
                      what: "cloud-costs",
                      dimension: "group",
                      viewName: spend.group.name,
                      basis: spend.basis || basisChoice.basis,
                      start: spend.start,
                      lastDay: spend.lastDay,
                    }),
                    mimeType: "text/csv;charset=utf-8;",
                  });
                },
              },
            ]}
          >
            <div data-testid="cloud-cost-group-chart">
              <CloudDailySpendChart
                points={spend.buckets.map((bucket: string, index: number) => {
                  return {
                    x: fromCloudCostDay(bucket),
                    y: spend.group.series[index] || 0,
                  };
                })}
                currency={spend.currency}
              />
            </div>
          </Card>
          <CardGrid
            columns={3}
            cardWidth="narrow"
            dataTestId="cloud-cost-group-top"
          >
            <Card title={GROUP_TOP_SERVICES}>
              <RankedBars
                emptyText={GROUP_TOP_EMPTY}
                items={toItems(spend.group.topServices, "service")}
              />
            </Card>
            <Card title={GROUP_TOP_RESOURCES}>
              <RankedBars
                emptyText={GROUP_TOP_EMPTY}
                items={toItems(spend.group.topResources, "resourceId")}
              />
            </Card>
            <Card title={GROUP_TOP_ACCOUNTS}>
              <RankedBars
                emptyText={GROUP_TOP_EMPTY}
                items={toItems(spend.group.topAccounts, "cloudAccountId")}
              />
            </Card>
          </CardGrid>
        </Fragment>
      )}
      <Card
        title={GROUP_RULES_TITLE}
        description={GROUP_RULES_DESCRIPTION}
        buttons={[
          {
            title: EDIT_RULES,
            icon: IconProp.Edit,
            disabled: Boolean(group.automaticKey),
            onClick: () => {
              setSaveError("");
              setEditing(readGroupRules(group));
            },
          },
        ]}
      >
        <CloudCostRuleSummary
          rules={readGroupRules(group)}
          names={ruleContext.names}
        />
      </Card>
      {editing ? (
        <Modal
          title={EDIT_RULES}
          modalWidth={ModalWidth.Large}
          submitButtonText={SAVE_RULES}
          onClose={() => {
            setEditing(null);
          }}
          onSubmit={() => {
            void saveRules();
          }}
          isLoading={isSaving}
          error={saveError}
        >
          <CloudCostRuleEditor
            value={editing}
            onChange={setEditing}
            names={ruleContext.names}
            options={ruleContext.options}
            showProblem={true}
          />
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CloudCostGroupPage;
