import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../../Components/AppLink/AppLink";
import CloudCommitmentsCard from "../../Components/Cloud/CloudCommitmentsCard";
import {
  getCloudCommitmentEndText,
  getCloudCommitmentEndTone,
  getCloudCommitmentPlanLines,
  getCloudCommitmentTermLine,
  getRecommendedCommitmentKind,
} from "../../Components/Cloud/CloudCommitmentWords";
import { formatCloudMoney } from "../../Components/Cloud/CloudCostWords";
import CloudStatStrip, {
  CloudStatTile,
} from "../../Components/Cloud/CloudStatStrip";
import CloudConnectCallout, {
  CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION,
} from "../../Components/Cloud/Connect/CloudConnectCallout";
import useCloudAccounts, {
  CloudAccountRow,
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudCommitment from "Common/Models/DatabaseModels/CloudCommitment";
import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import CloudCostSetting from "Common/Models/DatabaseModels/CloudCostSetting";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
  CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
  readCloudCommitmentExpiryDays,
  readCloudCommitmentPercentThreshold,
} from "Common/Types/Cloud/CloudCommitmentAlerts";
import {
  CLOUD_COMMITMENT_STATE_LABELS,
  CloudCommitmentFigures,
  CloudCommitmentState,
  getCloudCommitmentDaysLeft,
  getCloudCommitmentPurchaseUrl,
  isCloudCommitmentPaymentOption,
  readCloudCommitmentFigures,
} from "Common/Types/Cloud/CloudCommitmentInventory";
import {
  CloudCommitmentPlan,
  CloudCoverageFigures,
  getCloudCommitmentPurchasePlan,
  getCloudCommitmentRenewalPlan,
  readCloudCommitmentRecommendationDetails,
} from "Common/Types/Cloud/CloudCommitmentPlans";
import {
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentTotals,
  getCloudCommitmentCoveragePercent,
  getCloudCommitmentKindLabel,
  getCloudCommitmentUtilizationPercent,
  totalCloudCommitments,
} from "Common/Types/Cloud/CloudCommitments";
import { CloudCostState, CloudSavingKind } from "Common/Types/Cloud/CloudCost";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Cloud > Spend > Commitments (#11011): every Savings Plan, reservation and
 * committed use discount the connections read - when each ends, what it
 * covers, and what of it is used - so one never ends unnoticed:
 *
 *   - the strip: how many are active and end within 90 days, how much of
 *     them is used and what was left unused, how much of the spend they
 *     cover;
 *   - Ending soon: the ones that end within 90 days and do not renew
 *     themselves, each with its renewal plan - what to buy, what it saves,
 *     when it breaks even, how coverage falls if it lapses - and the link
 *     to renew it in its cloud's console;
 *   - All commitments: the inventory;
 *   - Purchase plans: what the clouds' recommenders suggest buying;
 *   - Coverage: each account's, by kind (CloudCommitmentsCard);
 *   - when the commitments alert, and the way to change it.
 *
 * OneUptime plans; a person buys, in the cloud's console.
 */

export const COMMITMENTS_PAGE_TITLE: string = translationKey("Commitments");
export const ENDING_SOON_TITLE: string = translationKey("Ending Soon");
export const ENDING_SOON_DESCRIPTION: string = translationKey(
  "Commitments that end within 90 days and do not renew themselves, with what to buy to keep their discount.",
);
export const ENDING_SOON_EMPTY: string = translationKey(
  "No commitment ends within 90 days.",
);
export const ALL_COMMITMENTS_TITLE: string = translationKey("All Commitments");
export const ALL_COMMITMENTS_DESCRIPTION: string = translationKey(
  "Every Savings Plan, reservation and committed use discount your connections read, once a day.",
);
export const COMMITMENTS_EMPTY: string = translationKey(
  "No commitments yet. Your cloud connections list them once a day, once they may read them.",
);
export const PURCHASE_PLANS_TITLE: string = translationKey("Purchase Plans");
export const PURCHASE_PLANS_DESCRIPTION: string = translationKey(
  "What your clouds' recommenders suggest committing to, with what each saves and when it breaks even.",
);
export const RENEW_IN_CONSOLE: string = translationKey("Renew in Console");
export const BUY_IN_CONSOLE: string = translationKey("Buy in Console");
export const ACTIVE_COMMITMENTS: string = translationKey("Active Commitments");
export const ENDING_WITHIN_90_DAYS: PluralTemplate = {
  one: "{{count}} ends within 90 days",
  other: "{{count}} end within 90 days",
};
export const NONE_ENDING_SOON: string = translationKey(
  "None ends within 90 days",
);
export const UTILIZATION_TITLE: string = translationKey("Utilization");
export const UTILIZATION_TILE_DESCRIPTION: string = translationKey(
  "Of what the commitments cost over the last 30 days, the share that paid for usage.",
);
export const UNUSED_AMOUNT: string = translationKey("{{amount}} unused");
export const COVERAGE_TITLE: string = translationKey("Coverage");
export const COVERAGE_TILE_DESCRIPTION: string = translationKey(
  "Of the spend a commitment could pay for over the last 30 days, the share one did.",
);
export const LAST_30_DAYS: string = translationKey("Last 30 days");
export const UTILIZATION_NOT_REPORTED: string = translationKey("Not reported");
export const COVERED_ON_DEMAND: string = translationKey(
  "{{amount}} at on-demand rates",
);
export const SAVED_AMOUNT: string = translationKey("Saved {{amount}}");
export const ALERTS_TITLE: string = translationKey("Alerts");
export const ALERTS_LINE: string = translationKey(
  "Commitments alert {{days}} days before they end, when used less than {{utilization}} over a week, and when an account's coverage falls under {{coverage}}.",
);
export const ALERTS_LINE_NO_COVERAGE: string = translationKey(
  "Commitments alert {{days}} days before they end, and when used less than {{utilization}} over a week.",
);
export const ALERTS_OFF: string = translationKey("Commitment alerts are off.");
export const CHANGE_ALERTS: string = translationKey("Change Alerts");
export const INVENTORY_NOT_READ: string = translationKey(
  "Some commitments could not be listed:",
);

// The days before an end that count as soon: the furthest alert's, by default.
export const ENDING_SOON_DAYS: number = 90;

const COMMITMENT_SELECT: Record<string, true | Record<string, true>> = {
  _id: true,
  cloudAccountId: true,
  provider: true,
  kind: true,
  commitmentId: true,
  name: true,
  commitmentType: true,
  covers: true,
  region: true,
  scope: true,
  appliesTo: true,
  termMonths: true,
  paymentOption: true,
  startsAt: true,
  endsAt: true,
  state: true,
  isAutoRenew: true,
  hourlyCommitment: true,
  quantity: true,
  upfrontCost: true,
  currency: true,
  utilizationPercent: true,
  figures: true,
};

// What a commitment's kind is called in its cloud.
function kindLabel(commitment: CloudCommitment): string {
  return getCloudCommitmentKindLabel({
    provider: commitment.provider || "",
    kind: (commitment.kind as CloudCommitmentKind) || "",
  });
}

/*
 * An account's coverage by a kind of commitment, as its savings summary
 * read it: what a plan's coverage change is measured against.
 */
export function getAccountCoverage(data: {
  accounts: Array<CloudAccountRow>;
  cloudAccountId: string;
  kind: string;
}): CloudCoverageFigures | null {
  const account: CloudAccountRow | undefined = data.accounts.find(
    (row: CloudAccountRow): boolean => {
      return row.id.toString() === data.cloudAccountId;
    },
  );
  const figures: CloudCommitmentKindFigures | undefined =
    account?.savingsSummary?.commitments?.kinds.find(
      (entry: CloudCommitmentKindFigures): boolean => {
        return entry.kind === data.kind;
      },
    );

  return figures
    ? {
        coveredSpend: figures.coveredSpend,
        onDemandSpend: figures.onDemandSpend,
      }
    : null;
}

// A commitment's renewal plan: null when its cloud says too little of it.
export function getRenewalPlanOf(data: {
  commitment: CloudCommitment;
  accounts: Array<CloudAccountRow>;
}): CloudCommitmentPlan | null {
  const commitment: CloudCommitment = data.commitment;

  return getCloudCommitmentRenewalPlan({
    termMonths: commitment.termMonths ?? null,
    paymentOption: isCloudCommitmentPaymentOption(commitment.paymentOption)
      ? commitment.paymentOption
      : null,
    hourlyCommitment:
      commitment.hourlyCommitment === undefined
        ? null
        : Number(commitment.hourlyCommitment),
    quantity:
      commitment.quantity === undefined ? null : Number(commitment.quantity),
    upfrontCost:
      commitment.upfrontCost === undefined
        ? null
        : Number(commitment.upfrontCost),
    utilizationPercent:
      commitment.utilizationPercent === undefined ||
      commitment.utilizationPercent === null
        ? null
        : Number(commitment.utilizationPercent),
    figures: readCloudCommitmentFigures(commitment.figures),
    currency: commitment.currency || "USD",
    coverage: getAccountCoverage({
      accounts: data.accounts,
      cloudAccountId: commitment.cloudAccountId?.toString() || "",
      kind: commitment.kind || "",
    }),
  });
}

const PlanLines: FunctionComponent<{
  lines: Array<string>;
  testId: string;
}> = (props: { lines: Array<string>; testId: string }): ReactElement => {
  return (
    <ul
      className="mt-1 space-y-0.5 text-sm text-gray-600"
      data-testid={props.testId}
    >
      {props.lines.map((line: string, index: number): ReactElement => {
        return <li key={index}>{line}</li>;
      })}
    </ul>
  );
};

const ConsoleLink: FunctionComponent<{
  url: string;
  text: string;
  testId: string;
}> = (props: { url: string; text: string; testId: string }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Link
      to={new Route(props.url)}
      openInNewTab={true}
      className="inline-flex shrink-0 items-center text-sm font-medium text-indigo-600 hover:underline"
      dataTestId={props.testId}
    >
      {translator.translateText(props.text) || props.text}
    </Link>
  );
};

const CloudCommitments: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const read: CloudAccountsRead = useCloudAccounts();
  const [commitments, setCommitments] = useState<Array<CloudCommitment> | null>(
    null,
  );
  const [recommendations, setRecommendations] = useState<
    Array<CloudCostRecommendation>
  >([]);
  const [setting, setSetting] = useState<CloudCostSetting | null>(null);
  const [error, setError] = useState<string>("");
  const now: Date = OneUptimeDate.getCurrentDate();

  useEffect(() => {
    let ignore: boolean = false;

    if (!projectId) {
      return;
    }

    Promise.all([
      ModelAPI.getList<CloudCommitment>({
        modelType: CloudCommitment,
        query: { projectId },
        select: COMMITMENT_SELECT as never,
        sort: { endsAt: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      }),
      ModelAPI.getList<CloudCostRecommendation>({
        modelType: CloudCostRecommendation,
        query: { kind: CloudSavingKind.Commitment },
        select: {
          _id: true,
          cloudAccountId: true,
          provider: true,
          region: true,
          action: true,
          resourceType: true,
          recommendedConfiguration: true,
          monthlySavings: true,
          monthlyCost: true,
          currency: true,
          commitmentDetails: true,
        },
        sort: { monthlySavings: SortOrder.Descending },
        skip: 0,
        limit: 20,
      }),
      ModelAPI.getList<CloudCostSetting>({
        modelType: CloudCostSetting,
        query: { projectId },
        select: {
          isCommitmentAlertsEnabled: true,
          commitmentExpiryAlertDays: true,
          commitmentUtilizationThreshold: true,
          commitmentCoverageThreshold: true,
        },
        sort: {},
        skip: 0,
        limit: 1,
      }),
    ])
      .then(
        ([commitmentList, recommendationList, settingList]: [
          ListResult<CloudCommitment>,
          ListResult<CloudCostRecommendation>,
          ListResult<CloudCostSetting>,
        ]): void => {
          if (ignore) {
            return;
          }

          setCommitments(commitmentList.data);
          setRecommendations(recommendationList.data);
          setSetting(settingList.data[0] || null);
        },
      )
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [projectId?.toString()]);

  const accountNames: Map<string, string> = useMemo((): Map<string, string> => {
    const names: Map<string, string> = new Map();

    for (const account of read.accounts) {
      names.set(account.id.toString(), account.name || account.accountId);
    }

    return names;
  }, [read.accounts]);

  if (read.isLoading && read.accounts.length === 0) {
    return <PageSkeleton />;
  }

  if (read.error && read.accounts.length === 0) {
    return <ErrorMessage message={read.error} onRefreshClick={read.refresh} />;
  }

  if (read.accounts.length === 0) {
    return (
      <CloudConnectCallout
        description={CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION}
      />
    );
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!commitments) {
    return <PageSkeleton />;
  }

  const money: (amount: number, currency: string) => string = (
    amount: number,
    currency: string,
  ): string => {
    return formatCloudMoney({ amount, currency, translator });
  };
  const percent: (value: number) => string = (value: number): string => {
    return `${translator.formatNumber(Math.round(value))}%`;
  };

  // The commitments that pay for usage now, and those of them that end within 90 days.
  const active: Array<CloudCommitment> = commitments.filter(
    (commitment: CloudCommitment): boolean => {
      return commitment.state === CloudCommitmentState.Active;
    },
  );
  const endingSoon: Array<CloudCommitment> = active.filter(
    (commitment: CloudCommitment): boolean => {
      if (!commitment.endsAt || commitment.isAutoRenew) {
        return false;
      }

      const daysLeft: number = getCloudCommitmentDaysLeft({
        endsAt: new Date(commitment.endsAt),
        now,
      });

      return daysLeft >= 0 && daysLeft <= ENDING_SOON_DAYS;
    },
  );
  const totals: CloudCommitmentTotals = totalCloudCommitments({
    summaries: read.accounts.map((account: CloudAccountRow) => {
      return account.savingsSummary?.commitments || null;
    }),
    currency: read.totals.costs.currency,
    readingState: CloudCostState.Reading,
  });
  const coverage: number | null = getCloudCommitmentCoveragePercent(totals);
  const utilization: number | null =
    getCloudCommitmentUtilizationPercent(totals);
  const tiles: Array<CloudStatTile> = [
    {
      key: "active",
      title: ACTIVE_COMMITMENTS,
      value: translator.formatNumber(active.length),
      sublabel:
        endingSoon.length > 0
          ? translator.translatePlural(ENDING_WITHIN_90_DAYS, endingSoon.length)
          : translator.translateText(NONE_ENDING_SOON) || NONE_ENDING_SOON,
      sublabelIsTranslated: true,
      icon: IconProp.Calendar,
      color: "indigo",
      tone: endingSoon.length > 0 ? "warning" : undefined,
    },
    {
      key: "utilization",
      title: UTILIZATION_TITLE,
      description: UTILIZATION_TILE_DESCRIPTION,
      value: utilization === null ? undefined : percent(utilization),
      sublabel:
        totals.unusedSpend !== null && totals.unusedSpend > 0
          ? translator.translateTemplate(UNUSED_AMOUNT, {
              amount: money(totals.unusedSpend, totals.currency),
            })
          : translator.translateText(LAST_30_DAYS) || LAST_30_DAYS,
      sublabelIsTranslated: true,
      icon: IconProp.ChartBar,
      color: "violet",
    },
    {
      key: "coverage",
      title: COVERAGE_TITLE,
      description: COVERAGE_TILE_DESCRIPTION,
      value: coverage === null ? undefined : percent(coverage),
      sublabel: LAST_30_DAYS,
      icon: IconProp.ArrowTrendingDown,
      color: "emerald",
    },
  ];

  // When the commitments alert, as the project's settings say.
  const expiryDays: Array<number> = readCloudCommitmentExpiryDays(
    setting?.commitmentExpiryAlertDays,
  );
  const utilizationThreshold: number | null =
    readCloudCommitmentPercentThreshold(
      setting?.commitmentUtilizationThreshold,
      CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
    );
  const coverageThreshold: number | null =
    setting === null || setting.commitmentCoverageThreshold === undefined
      ? CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD
      : readCloudCommitmentPercentThreshold(
          setting.commitmentCoverageThreshold,
          null,
        );
  const alertsLine: string =
    setting?.isCommitmentAlertsEnabled === false
      ? translator.translateText(ALERTS_OFF) || ALERTS_OFF
      : translator.translateTemplate(
          coverageThreshold === null ? ALERTS_LINE_NO_COVERAGE : ALERTS_LINE,
          {
            days: expiryDays
              .map((day: number): string => {
                return translator.formatNumber(day);
              })
              .join(", "),
            utilization: percent(
              utilizationThreshold ??
                CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
            ),
            coverage: percent(coverageThreshold ?? 0),
          },
        );

  // What the connections could not list, in their clouds' words.
  const inventoryProblems: Array<{ key: string; message: string }> =
    read.accounts
      .map((account: CloudAccountRow) => {
        const inventory:
          | { state: string; message?: string | undefined }
          | undefined = account.savingsSummary?.commitments?.inventory;

        return inventory && inventory.message
          ? { key: account.id.toString(), message: inventory.message }
          : null;
      })
      .filter((entry: { key: string; message: string } | null): boolean => {
        return entry !== null;
      })
      .filter(
        (
          entry: { key: string; message: string } | null,
          index: number,
          all: Array<{ key: string; message: string } | null>,
        ): boolean => {
          // One line per message: an organization's accounts say it once.
          return (
            all.findIndex(
              (other: { key: string; message: string } | null): boolean => {
                return other?.message === entry?.message;
              },
            ) === index
          );
        },
      ) as Array<{ key: string; message: string }>;

  return (
    <Fragment>
      <CloudStatStrip testId="cloud-commitments-strip" tiles={tiles} />

      <Card title={ENDING_SOON_TITLE} description={ENDING_SOON_DESCRIPTION}>
        <div data-testid="cloud-commitments-ending-soon">
          {endingSoon.length === 0 ? (
            <p className="text-sm text-gray-600">
              {translator.translateText(ENDING_SOON_EMPTY)}
            </p>
          ) : (
            <ul className="-mt-3 divide-y divide-gray-100">
              {endingSoon.map((commitment: CloudCommitment): ReactElement => {
                const daysLeft: number = getCloudCommitmentDaysLeft({
                  endsAt: new Date(commitment.endsAt!),
                  now,
                });
                const plan: CloudCommitmentPlan | null = getRenewalPlanOf({
                  commitment,
                  accounts: read.accounts,
                });
                const lines: Array<string> = plan
                  ? getCloudCommitmentPlanLines({
                      plan,
                      quantityOf: commitment.covers
                        ?.split(",")[0]
                        ?.split("×")[1]
                        ?.trim(),
                      translator,
                    })
                  : [];
                const tone: "danger" | "warning" | "neutral" =
                  getCloudCommitmentEndTone(daysLeft);

                return (
                  <li
                    key={commitment.id?.toString()}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="cloud-commitment-ending"
                    data-days-left={daysLeft}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words text-sm font-medium text-gray-900">
                          <bdi>{commitment.name}</bdi>
                        </span>
                        <Pill
                          text={
                            getCloudCommitmentEndText({
                              daysLeft,
                              isAutoRenew: false,
                              translator,
                            }) || ""
                          }
                          isUserContent={true}
                          tone={
                            tone === "danger"
                              ? PillTone.Danger
                              : tone === "warning"
                                ? PillTone.Warning
                                : PillTone.Neutral
                          }
                        />
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {[
                          translator.translateText(kindLabel(commitment)),
                          commitment.commitmentType,
                          commitment.covers,
                          accountNames.get(
                            commitment.cloudAccountId?.toString() || "",
                          ),
                        ]
                          .filter((part: string | undefined): boolean => {
                            return Boolean(part);
                          })
                          .join(" · ")}
                      </div>
                      {lines.length > 0 ? (
                        <PlanLines
                          lines={lines}
                          testId="cloud-commitment-renewal-plan"
                        />
                      ) : (
                        <></>
                      )}
                    </div>
                    <ConsoleLink
                      url={getCloudCommitmentPurchaseUrl({
                        provider: commitment.provider || "",
                        kind: commitment.kind || "",
                        service: commitment.commitmentType || "",
                        region: commitment.region || "",
                        accountId: accountNames.get(
                          commitment.cloudAccountId?.toString() || "",
                        ),
                      })}
                      text={RENEW_IN_CONSOLE}
                      testId="cloud-commitment-renew-link"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <ModelTable<CloudCommitment>
        modelType={CloudCommitment}
        id="cloud-commitments-table"
        userPreferencesKey="cloud-commitments-table"
        name="Cloud > Commitments"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        sortBy="endsAt"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: ALL_COMMITMENTS_TITLE,
          description: ALL_COMMITMENTS_DESCRIPTION,
        }}
        noItemsMessage={COMMITMENTS_EMPTY}
        selectMoreFields={{
          provider: true,
          kind: true,
          commitmentType: true,
          covers: true,
          region: true,
          isAutoRenew: true,
          termMonths: true,
          paymentOption: true,
          figures: true,
          currency: true,
          cloudAccountId: true,
          hourlyCommitment: true,
          quantity: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { cloudAccount: { name: true } },
            title: "Account",
            type: FieldType.Entity,
            filterEntityType: CloudAccount,
            filterDropdownField: { label: "name", value: "_id" },
          },
          {
            field: { state: true },
            title: "State",
            type: FieldType.Dropdown,
            filterDropdownOptions: Object.values(CloudCommitmentState).map(
              (state: CloudCommitmentState) => {
                return {
                  label: CLOUD_COMMITMENT_STATE_LABELS[state],
                  value: state,
                };
              },
            ),
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Commitment",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            getLineText: drawsItsOwnLines,
            getElement: (item: CloudCommitment): ReactElement => {
              return (
                <div className="min-w-0" data-testid="cloud-commitment-row">
                  <div className="break-words text-sm font-medium text-gray-900">
                    <bdi>{item.name}</bdi>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {[
                      translator.translateText(kindLabel(item)),
                      item.commitmentType,
                      item.covers,
                      item.region,
                    ]
                      .filter((part: string | undefined): boolean => {
                        return Boolean(part);
                      })
                      .join(" · ")}
                  </div>
                </div>
              );
            },
          },
          {
            field: { cloudAccount: { name: true } },
            title: "Account",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudCommitment): ReactElement => {
              return item.cloudAccountId ? (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                    { modelId: new ObjectID(item.cloudAccountId.toString()) },
                  )}
                  className="break-words text-sm text-gray-900 hover:underline"
                >
                  {item.cloudAccount?.name ||
                    accountNames.get(item.cloudAccountId.toString()) ||
                    ""}
                </AppLink>
              ) : (
                <></>
              );
            },
          },
          {
            field: { endsAt: true },
            title: "Ends",
            type: FieldType.Element,
            getElement: (item: CloudCommitment): ReactElement => {
              const daysLeft: number | null = item.endsAt
                ? getCloudCommitmentDaysLeft({
                    endsAt: new Date(item.endsAt),
                    now,
                  })
                : null;
              const tone: "danger" | "warning" | "neutral" =
                getCloudCommitmentEndTone(daysLeft);
              const text: string | null = getCloudCommitmentEndText({
                daysLeft,
                isAutoRenew: item.isAutoRenew === true,
                translator,
              });

              return (
                <div data-testid="cloud-commitment-ends">
                  <div className="text-sm text-gray-900">
                    {item.endsAt
                      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          new Date(item.endsAt),
                          true,
                        )
                      : ""}
                  </div>
                  {text ? (
                    <div className="mt-1">
                      <Pill
                        text={text}
                        isUserContent={true}
                        tone={
                          item.isAutoRenew
                            ? PillTone.Success
                            : tone === "danger"
                              ? PillTone.Danger
                              : tone === "warning"
                                ? PillTone.Warning
                                : PillTone.Neutral
                        }
                      />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { termMonths: true },
            title: "Term",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudCommitment): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getCloudCommitmentTermLine({
                    termMonths: item.termMonths,
                    paymentOption: isCloudCommitmentPaymentOption(
                      item.paymentOption,
                    )
                      ? item.paymentOption
                      : null,
                    translator,
                  })}
                </span>
              );
            },
          },
          {
            field: { utilizationPercent: true },
            title: "Utilization",
            type: FieldType.Element,
            getElement: (item: CloudCommitment): ReactElement => {
              if (
                item.utilizationPercent === undefined ||
                item.utilizationPercent === null
              ) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText(UTILIZATION_NOT_REPORTED)}
                  </span>
                );
              }

              const value: number = Math.min(
                100,
                Math.max(0, Number(item.utilizationPercent) || 0),
              );

              return (
                <div
                  className="min-w-[6rem]"
                  data-testid="cloud-commitment-utilization"
                >
                  <div className="text-sm text-gray-900">{percent(value)}</div>
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                    role="presentation"
                  >
                    <div
                      className={`h-full rounded-full ${
                        value < CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              );
            },
          },
          {
            field: { figures: true },
            title: "Covered",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudCommitment): ReactElement => {
              const figures: CloudCommitmentFigures | null =
                readCloudCommitmentFigures(item.figures);
              const currency: string = item.currency || "USD";

              if (!figures || figures.coveredOnDemandCost === null) {
                return <span className="text-sm text-gray-400">&ndash;</span>;
              }

              return (
                <div className="text-sm" data-testid="cloud-commitment-covered">
                  <div className="text-gray-900">
                    {translator.translateTemplate(COVERED_ON_DEMAND, {
                      amount: money(figures.coveredOnDemandCost, currency),
                    })}
                  </div>
                  {figures.netSavings !== null ? (
                    <div className="mt-0.5 text-xs text-gray-500">
                      {translator.translateTemplate(SAVED_AMOUNT, {
                        amount: money(figures.netSavings, currency),
                      })}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      {recommendations.length > 0 ? (
        <Card
          title={PURCHASE_PLANS_TITLE}
          description={PURCHASE_PLANS_DESCRIPTION}
        >
          <ul
            className="-mt-3 divide-y divide-gray-100"
            data-testid="cloud-commitment-purchase-plans"
          >
            {recommendations.map(
              (recommendation: CloudCostRecommendation): ReactElement => {
                const provider: string = recommendation.provider || "";
                const words: string = `${recommendation.action || ""} ${recommendation.resourceType || ""}`;
                const kind: CloudCommitmentKind = getRecommendedCommitmentKind({
                  provider,
                  words,
                });
                const plan: CloudCommitmentPlan =
                  getCloudCommitmentPurchasePlan({
                    monthlySavings: Number(recommendation.monthlySavings) || 0,
                    monthlyCost:
                      recommendation.monthlyCost === undefined ||
                      recommendation.monthlyCost === null
                        ? null
                        : Number(recommendation.monthlyCost),
                    details: readCloudCommitmentRecommendationDetails(
                      recommendation.commitmentDetails,
                    ),
                    currency: recommendation.currency || "USD",
                    coverage: getAccountCoverage({
                      accounts: read.accounts,
                      cloudAccountId:
                        recommendation.cloudAccountId?.toString() || "",
                      kind,
                    }),
                  });

                return (
                  <li
                    key={recommendation.id?.toString()}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="cloud-commitment-purchase-plan"
                  >
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-gray-900">
                        <bdi>
                          {[
                            recommendation.action,
                            recommendation.recommendedConfiguration,
                          ]
                            .filter((part: string | undefined): boolean => {
                              return Boolean(part);
                            })
                            .join(": ")}
                        </bdi>
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {[
                          translator.translateText(
                            getCloudCommitmentKindLabel({ provider, kind }),
                          ),
                          accountNames.get(
                            recommendation.cloudAccountId?.toString() || "",
                          ),
                          recommendation.region,
                        ]
                          .filter((part: string | undefined): boolean => {
                            return Boolean(part);
                          })
                          .join(" · ")}
                      </div>
                      <PlanLines
                        lines={getCloudCommitmentPlanLines({
                          plan,
                          translator,
                        })}
                        testId="cloud-commitment-purchase-plan-lines"
                      />
                    </div>
                    <ConsoleLink
                      url={getCloudCommitmentPurchaseUrl({
                        provider,
                        kind,
                        region: recommendation.region || "",
                      })}
                      text={BUY_IN_CONSOLE}
                      testId="cloud-commitment-buy-link"
                    />
                  </li>
                );
              },
            )}
          </ul>
        </Card>
      ) : (
        <></>
      )}

      <CloudCommitmentsCard accounts={read.accounts} />

      <Card
        title={ALERTS_TITLE}
        buttons={[
          <AppLink
            key="change-alerts"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_SETTINGS_COSTS] as Route,
            )}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText(CHANGE_ALERTS) || CHANGE_ALERTS}
          </AppLink>,
        ]}
      >
        <div data-testid="cloud-commitment-alerts">
          <p className="text-sm text-gray-600">{alertsLine}</p>
          {inventoryProblems.length > 0 ? (
            <div
              className="mt-3"
              data-testid="cloud-commitment-inventory-problems"
            >
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(INVENTORY_NOT_READ)}
              </p>
              <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-gray-600">
                {inventoryProblems.map(
                  (problem: { key: string; message: string }): ReactElement => {
                    // The cloud's own words, as the connection said them.
                    return <li key={problem.key}>{problem.message}</li>;
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>
    </Fragment>
  );
};

export default CloudCommitments;
